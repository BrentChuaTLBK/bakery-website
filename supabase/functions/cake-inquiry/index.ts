import { credentials, endpoint, env, field, HttpError, json, readBody, uuid } from "../_shared/server.ts";
import { imageType } from "../_shared/images.ts";

const owner = "Tlbk.kitchen@gmail.com";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
async function receipt(action: string, payload: Record<string, unknown>): Promise<any> {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/rpc/cake_inquiry_service`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: action, p_payload: payload }), signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.state) throw new HttpError(503, "We could not confirm the inquiry status. Wait one minute, then retry with the same details.");
  return data;
}
export const handler = endpoint(async (request, headers) => {
  // Public form, authenticated to this project's publishable key. Durable
  // database quotas and idempotency below remain the anti-abuse boundary.
  let publishable: unknown[]=[];
  try { publishable=Object.values(JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')||'{}')); } catch {}
  const allowedKeys=[env('SUPABASE_ANON_KEY'),...publishable].filter(key=>typeof key==='string'&&key.length>0);
  if(!allowedKeys.length)throw new HttpError(503,'Cake inquiries are temporarily unavailable. Please email Tlbk.kitchen@gmail.com.');
  if(!allowedKeys.includes(request.headers.get('apikey')))throw new HttpError(401,'Open the cake inquiry form on the TLB website.');
  const providerKey = env("RESEND_API_KEY"), from = env("EMAIL_FROM");
  if (!providerKey || !from) throw new HttpError(503, "Cake inquiries are temporarily unavailable. Please email Tlbk.kitchen@gmail.com.");
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new HttpError(400, "Please submit the cake inquiry form.");
  const bytes = await readBody(request, 5 * 1024 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw new HttpError(400, "The form could not be read. Please try again."); }
  const raw = form.get("details");
  if (typeof raw !== "string" || raw.length > 12000 || form.getAll("details").length !== 1) throw new HttpError(400, "Cake details are missing or too long.");
  let input: any;
  try { input = JSON.parse(raw); if (!input || Array.isArray(input)) throw Error(); }
  catch { throw new HttpError(400, "Cake details are invalid."); }
  if (input.website) throw new HttpError(400, "Please submit the inquiry using the form.");
  const id = uuid(input.id, "Inquiry reference");
  const name = field(input.name, "Your name", 100, true);
  const email = field(input.email, "Email", 254, true).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const date = field(input.date, "Preferred date", 10, true);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < today) throw new HttpError(400, "Choose today or a future date.");
  const occasion = field(input.occasion, "Occasion", 150, true);
  const size = field(input.size, "Size of cake", 150, true);
  const theme = field(input.theme, "Theme", 2000, true);
  const budget = field(input.budget, "Budget", 100);
  const social = field(input.social, "Social media contact", 250, true);
  if (/[\r\n\x00-\x1f\x7f]/.test(name + occasion + size + budget + social)) throw new HttpError(400, "Use a single line for your contact details, occasion, size, and budget.");
  const photos = form.getAll("photos");
  if (photos.length > 4) throw new HttpError(400, "Choose up to four reference photos.");
  const attachments = [];
  for (const [index, photo] of photos.entries()) {
    if (!(photo instanceof File) || !photo.size || photo.size > 1024 * 1024) throw new HttpError(413, "Each prepared photo must be 1 MB or smaller. Please choose a smaller photo.");
    const photoBytes = new Uint8Array(await photo.arrayBuffer());
    const type = imageType(photoBytes);
    if (photo.type !== type.mime) throw new HttpError(415, "A photo's contents do not match its image type.");
    attachments.push({ filename: `cake-reference-${index + 1}.${type.extension}`, content: base64(photoBytes), content_type: type.mime });
  }
  const fields = [["Name", name], ["Email", email], ["Social media", social], ["Preferred date", `${date} (Philippines)`], ["Occasion", occasion], ["Size of cake", size], ["Theme", theme], ["Budget", budget || "Not specified"], ["Reference photos", String(photos.length)]];
  const intro = "A custom cake inquiry was submitted on the TLB Kitchen website. The client is copied on this email. Reply all to continue the conversation. Availability, design, price, and booking are still to be confirmed by TLB Kitchen.";
  const message = {
    from, to: [owner], ...(email !== owner.toLowerCase() ? { cc: [email] } : {}),
    reply_to: [...new Set([owner.toLowerCase(), email])],
    subject: `Custom cake inquiry · ${date} · ${id.slice(0, 8)}`,
    html: `<!doctype html><html><body style="margin:0;background:#fffaf4;font-family:Arial,sans-serif;color:#382822"><main style="max-width:600px;margin:auto;padding:28px"><p style="font-weight:bold;color:#a54850">TLB KITCHEN</p><h1 style="font-size:26px">Custom cake inquiry</h1><p style="line-height:1.6">${intro}</p><table role="presentation" style="width:100%;border-collapse:collapse">${fields.map(([label, value]) => `<tr><th scope="row" style="text-align:left;vertical-align:top;padding:12px 12px 12px 0;border-bottom:1px solid #e5d7cb">${label}</th><td style="padding:12px 0;border-bottom:1px solid #e5d7cb;white-space:pre-wrap;overflow-wrap:anywhere">${escape(value)}</td></tr>`).join("")}</table><p style="font-size:13px">Reference: ${id}<br>Sent for this inquiry only. This does not subscribe you to marketing emails.</p></main></body></html>`,
    text: `TLB KITCHEN — Custom cake inquiry\n\n${intro}\n\n${fields.map(([label, value]) => `${label}: ${value}`).join("\n\n")}\n\nReference: ${id}\nSent for this inquiry only. This does not subscribe you to marketing emails.`,
    attachments,
  };
  const { key } = credentials();
  // Salt contact hashes with the existing server-only credential. Raw contact
  // details and network addresses never enter the delivery receipt table.
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 100);
  const claim = await receipt("claim", { id, fingerprint: await digest(JSON.stringify(message)), email_hash: await digest(`${key}:cake-email:${email}`), ip_hash: await digest(`${key}:cake-ip:${ip}`) });
  if (claim.state === "accepted") return json({ accepted: true, reference: id }, 200, headers);
  if (claim.state === "limited") throw new HttpError(429, "Please wait before sending another inquiry, or email Tlbk.kitchen@gmail.com directly.");
  if (claim.state === "busy") throw new HttpError(409, "Your inquiry is still being checked. Wait one minute, then retry with the same details.");
  if (claim.state === "expired") throw new HttpError(409, "Please check your email for this inquiry before contacting Tlbk.kitchen@gmail.com. This request cannot be resent automatically.");
  if (claim.state !== "claimed" || !claim.lease_token) throw new HttpError(409, "This inquiry reference has different details. Please reopen the form.");
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${providerKey}`, "Content-Type": "application/json", "Idempotency-Key": `cake-inquiry:${id}` },
      body: JSON.stringify(message), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(503, "We could not confirm email delivery. Wait one minute, then retry with the same details."); }
  const sent = await response.json().catch(() => null);
  if (!response.ok || typeof sent?.id !== "string") throw new HttpError(503, "The email service is temporarily unavailable. Wait one minute, then retry with the same details.");
  await receipt("accepted", { id, lease_token: claim.lease_token, provider_id: sent.id });
  return json({ accepted: true, reference: id }, 200, headers);
});
Deno.serve(handler);
