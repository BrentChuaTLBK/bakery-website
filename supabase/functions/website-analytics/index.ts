import { credentials, endpoint, HttpError, json, verifiedUser } from "../_shared/server.ts";
import { createReporter } from "./reporting.ts";

const report = createReporter();

async function authorizeStaff(userId: string): Promise<void> {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/rpc/shop_service`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: "authorize_analytics", p_payload: { user_id: userId } }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.allowed !== true) {
    if (result?.code === "42501") throw new HttpError(403, "Staff access is required to view website analytics.");
    throw new HttpError(503, "Website analytics access could not be checked. Please try again.");
  }
}

Deno.serve(endpoint(async (request, headers) => {
  const userId = await verifiedUser(request, true);
  // Recheck current database membership on every request, before configuration or cached report access.
  await authorizeStaff(userId!);
  return json(await report(), 200, headers);
}));
