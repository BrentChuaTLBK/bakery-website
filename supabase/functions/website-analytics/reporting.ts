import { env, HttpError } from "../_shared/server.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const CACHE_MS = 60_000;
const NETWORK_TIMEOUT_MS = 10_000;

type Configuration = { property: string; email: string; privateKey: string; keyId?: string; identity: string };
export type VisitorReport = {
  status: "ready" | "partial" | "unavailable";
  visitorsToday: number | null; activeLast30Minutes: number | null; timeZone: string | null; updatedAt: string;
  issues?: { today?: ReportIssue; realtime?: ReportIssue };
};

type ReportIssue = "report_pending" | "metric_mismatch" | "restricted" | "withheld" | "unexpected_report" |
  "network" | "access" | "busy" | "day_changed";
class ReportError extends HttpError {
  constructor(public issue: ReportIssue, message: string) { super(502, message); }
}

type Dependencies = {
  getEnv?: (name: string) => string;
  fetch?: typeof fetch;
  now?: () => number;
};

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodedJson(value: unknown): string { return base64Url(new TextEncoder().encode(JSON.stringify(value))); }

function configuration(getEnv: (name: string) => string): Configuration | null {
  const property = getEnv("GA_PROPERTY_ID").trim();
  const accountJson = getEnv("GA_SERVICE_ACCOUNT_JSON").trim();
  if (!property || !accountJson) return null;
  try {
    const account = JSON.parse(accountJson);
    if (!/^[1-9][0-9]{0,19}$/.test(property) || account.type !== "service_account" ||
      typeof account.client_email !== "string" || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(account.client_email) ||
      typeof account.private_key !== "string" || !account.private_key.startsWith("-----BEGIN PRIVATE KEY-----")) throw new Error();
    return { property, email: account.client_email, privateKey: account.private_key,
      keyId: typeof account.private_key_id === "string" ? account.private_key_id : undefined,
      identity: `${property}\n${accountJson}` };
  } catch { throw new HttpError(503, "The Google Analytics reporting connection needs its settings checked."); }
}

// No page dimensions or filters are requested: Google deduplicates users across
// the property. Google may describe the single requested period with dateRange;
// this is a period label, not a breakdown of visitors to be added together.
function aggregate(report: any, metric: string): number {
  const label = metric === "totalUsers" ? "today's visitor report" : "the realtime visitor report";
  const reject = (reason: string, issue: ReportIssue = "unexpected_report"): never => {
    // Only fixed descriptions are returned, never raw provider data or errors.
    throw new ReportError(issue, `Google Analytics could not supply ${label}: ${reason}.`);
  };
  if (!report || report.error) reject("no valid report was returned");
  if ((report.metadata?.schemaRestrictionResponse?.activeMetricRestrictions?.length || 0) > 0) {
    reject("Google is restricting access to the requested metric", "restricted");
  }
  if (report.metadata?.emptyReason) reject("Google marked the report as unavailable; try again later", report.metadata?.subjectToThresholding ? "withheld" : "report_pending");
  const dimensions = report.dimensionHeaders ?? [];
  const singlePeriod = Array.isArray(dimensions) && dimensions.length === 1 && dimensions[0]?.name === "dateRange";
  if (!Array.isArray(dimensions) || (dimensions.length !== 0 && !singlePeriod)) {
    reject("an unexpected visitor grouping was returned");
  }
  if (!Array.isArray(report.metricHeaders) || report.metricHeaders.length !== 1 || report.metricHeaders[0]?.name !== metric) {
    // An empty/missing metric header is not a verified zero. Keep this card
    // unavailable while allowing the other report to be displayed.
    const noHeaders = report.metricHeaders == null || (Array.isArray(report.metricHeaders) && report.metricHeaders.length === 0);
    const noRows = report.rows == null || (Array.isArray(report.rows) && report.rows.length === 0);
    const empty = noHeaders && noRows && (report.rowCount === undefined || report.rowCount === 0);
    reject("the requested visitor metric is missing", report.metadata?.subjectToThresholding ? "withheld" : empty ? "report_pending" : "metric_mismatch");
  }
  const rows = report.rows ?? [];
  if (!Array.isArray(rows) || rows.length > 1 || (report.rowCount !== undefined && report.rowCount !== rows.length)) {
    throw new HttpError(502, "Google Analytics returned an unexpected visitor report.");
  }
  if (!rows.length) {
    if (report.metadata?.subjectToThresholding) reject("Google is withholding this report because of its data thresholds", "withheld");
    return 0; // A successful, valid report with no rows means no reported visitors.
  }
  const dimensionValues = rows[0]?.dimensionValues ?? [];
  if (!Array.isArray(dimensionValues) || (singlePeriod
    ? dimensionValues.length !== 1 || dimensionValues[0]?.value !== "date_range_0"
    : dimensionValues.length !== 0)) {
    reject("the returned reporting period does not match the request");
  }
  const values = rows[0]?.metricValues;
  const value = values?.[0]?.value;
  if (values?.length !== 1 || typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new HttpError(502, "Google Analytics returned an unexpected visitor count.");
  }
  return Number(value);
}
function reportDay(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

// State lives only in this server isolate. Credentials and access tokens are never returned to clients.
export function createReporter(dependencies: Dependencies = {}) {
  const getEnv = dependencies.getEnv || env;
  const fetcher = dependencies.fetch || ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = dependencies.now || Date.now;
  let identity = "";
  let accessToken: { value: string; expiresAt: number } | null = null;
  let tokenPending: Promise<string> | null = null;
  let reportPending: Promise<VisitorReport> | null = null;
  let cached: { report: VisitorReport; expiresAt: number } | null = null;

  async function request(url: string, init: RequestInit): Promise<Response> {
    try { return await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }); }
    catch { throw new ReportError("network", "Google Analytics is temporarily unavailable. Please try again shortly."); }
  }

  async function token(config: Configuration): Promise<string> {
    if (accessToken && accessToken.expiresAt > now()) return accessToken.value;
    if (tokenPending) return tokenPending;
    const pending = (async () => {
      const issued = Math.floor(now() / 1000);
      const header = encodedJson({ alg: "RS256", typ: "JWT", ...(config.keyId ? { kid: config.keyId } : {}) });
      const claims = encodedJson({ iss: config.email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 });
      const unsigned = `${header}.${claims}`;
      let signature: ArrayBuffer;
      try {
        const keyBytes = Uint8Array.from(atob(config.privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
      } catch { throw new HttpError(503, "The Google Analytics reporting key needs to be checked."); }
      const response = await request(TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.access_token !== "string" || !data.access_token || data.token_type?.toLowerCase() !== "bearer" ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        throw new HttpError(503, "Google could not authorize the reporting connection. Check its service account key.");
      }
      if (identity === config.identity) accessToken = { value: data.access_token, expiresAt: now() + Math.max(0, Math.min(data.expires_in, 3600) - 60) * 1000 };
      return data.access_token;
    })();
    tokenPending = pending;
    try { return await pending; } finally { if (tokenPending === pending) tokenPending = null; }
  }

  async function googleReport(config: Configuration, bearer: string, method: string, body: unknown) {
    const response = await request(`https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:${method}`, {
      method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401 && identity === config.identity) accessToken = null;
      if ([401, 403].includes(response.status)) throw new ReportError("access", "Google Analytics access is not ready. Check the property ID, Viewer access and enabled Data API.");
      if (response.status === 429) throw new ReportError("busy", "Google Analytics is busy. Please wait a minute before refreshing.");
      throw new HttpError(502, "Google Analytics could not load visitor counts. Please try again shortly.");
    }
    return await response.json().catch(() => { throw new HttpError(502, "Google Analytics returned an unreadable report."); });
  }

  return async (): Promise<VisitorReport | { status: "not_configured" }> => {
    const config = configuration(getEnv);
    if (!config) return { status: "not_configured" };
    if (config.identity !== identity) {
      identity = config.identity; accessToken = null; tokenPending = null; reportPending = null; cached = null;
    }
    if (cached && cached.expiresAt > now() && cached.report.timeZone &&
      reportDay(Date.parse(cached.report.updatedAt), cached.report.timeZone) === reportDay(now(), cached.report.timeZone)) return cached.report;
    if (reportPending) return reportPending;
    const pending = (async () => {
      const bearer = await token(config);
      const startedAt = now();
      let timeZone: string | null = null;
      const [daily, realtime] = await Promise.allSettled([
        (async () => {
          const data = await googleReport(config, bearer, "runReport", { dateRanges: [{ startDate: "today", endDate: "today" }], metrics: [{ name: "totalUsers" }] });
          const zone = data?.metadata?.timeZone;
          try {
            if (typeof zone !== "string" || !zone) throw new Error();
            reportDay(now(), zone);
          } catch { throw new ReportError("unexpected_report", "Google Analytics did not return its reporting timezone."); }
          timeZone = zone;
          if (reportDay(startedAt, zone) !== reportDay(now(), zone)) {
            throw new ReportError("day_changed", "A new reporting day just started. Refresh to load today’s visitor counts.");
          }
          return aggregate(data, "totalUsers");
        })(),
        // Google's default is exactly the last 30 minutes, including for 360
        // properties. No explicit range or visitor breakdown is needed.
        googleReport(config, bearer, "runRealtimeReport", { metrics: [{ name: "activeUsers" }] }).then(data => aggregate(data, "activeUsers")),
      ]);
      const issues: NonNullable<VisitorReport["issues"]> = {};
      const issue = (error: unknown): ReportIssue => error instanceof ReportError ? error.issue : "unexpected_report";
      if (daily.status === "rejected") issues.today = issue(daily.reason);
      if (realtime.status === "rejected") issues.realtime = issue(realtime.reason);
      let visitorsToday = daily.status === "fulfilled" ? daily.value : null;
      const activeLast30Minutes = realtime.status === "fulfilled" ? realtime.value : null;
      // Realtime may finish after midnight even if the daily request finished
      // before it. Never stamp yesterday's total with the new reporting day.
      if (visitorsToday !== null && timeZone && reportDay(startedAt, timeZone) !== reportDay(now(), timeZone)) {
        visitorsToday = null;
        issues.today = "day_changed";
      }
      const report: VisitorReport = {
        status: visitorsToday !== null && activeLast30Minutes !== null ? "ready" :
          visitorsToday !== null || activeLast30Minutes !== null ? "partial" : "unavailable",
        visitorsToday, activeLast30Minutes,
        timeZone, updatedAt: new Date(now()).toISOString(),
        ...(Object.keys(issues).length ? { issues } : {}),
      };
      // Retry partial reports on refresh. Neither a missing nor a failed count
      // is converted into zero, reused from yesterday or substituted with Realtime.
      if (identity === config.identity && report.status === "ready") cached = { report, expiresAt: now() + CACHE_MS };
      return report;
    })();
    reportPending = pending;
    try { return await pending; } finally { if (reportPending === pending) reportPending = null; }
  };
}
