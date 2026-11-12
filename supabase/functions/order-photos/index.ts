import { credentials, endpoint, field, HttpError, json, readBody, readJson, service, storageRequest, uuid, verifiedUser } from "../_shared/server.ts";
import { imageType, MAX_PHOTO_BYTES } from "../_shared/images.ts";

const bucket = "order-photos";
const signedLifetime = 300;
const photoLimit = 8;

type Photo = { id: string; storage_path: string; filename?: string; sha256?: string };

async function sign(photo: Photo, shared = false) {
  let url = null;
  try {
    const result = await storageRequest(`object/sign/${bucket}/${photo.storage_path}`, "POST",
      JSON.stringify({ expiresIn: signedLifetime }), "application/json");
    const path = result?.signedURL || result?.signedUrl;
    if (typeof path === "string") {
      const base = credentials().url;
      const signed = new URL(path.startsWith("/object/") ? `/storage/v1${path}` : path, base);
      if (signed.origin === new URL(base).origin) url = signed.href;
    }
  } catch { /* Keep the entry visible if its preview is temporarily unavailable. */ }
  return { id: photo.id, url, ...(shared ? {} : { filename: photo.filename }) };
}

async function removeObject(path: string) {
  await storageRequest(`object/${bucket}`, "DELETE", JSON.stringify({ prefixes: [path] }), "application/json");
}

async function uploadPhoto(request: Request, userId: string, contentType: string) {
  const bytes = await readBody(request, MAX_PHOTO_BYTES + 65536);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HttpError(400, "The photo upload is invalid."); }
  const orderId = uuid(form.get("order_id")).toLowerCase();
  const scope = { order_id: orderId, user_id: userId };
  const photos: Photo[] = await service("order_photo_list", scope);
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) throw new HttpError(400, "Choose one photo to upload.");
  const contents = new Uint8Array(await file.arrayBuffer());
  const image = imageType(contents, MAX_PHOTO_BYTES);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", contents))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const existing = photos.find(photo => photo.sha256 === sha256);
  if (existing) return { id: existing.id };
  if (photos.length >= photoLimit) throw new HttpError(400, "An order can have up to 8 photos.");

  const photoId = crypto.randomUUID();
  const path = `${orderId}/${photoId}.${image.extension}`;
  await storageRequest(`object/${bucket}/${path}`, "POST", contents, image.mime);
  try {
    const result = await service("order_photo_attach", {
      ...scope, photo_id: photoId, storage_path: path, mime_type: image.mime, sha256,
      filename: file.name.trim().slice(0, 180) || "Order photo",
    });
    if (!result.accepted) await removeObject(path).catch(() => {});
    return { id: result.id };
  } catch (error) {
    // A response may be lost after commit. Read through the same order lock
    // before cleaning up, so a committed attachment keeps its object.
    try {
      const current: Photo[] = await service("order_photo_list", scope);
      const saved = current.find(photo => photo.sha256 === sha256);
      if (!saved || saved.storage_path !== path) await removeObject(path).catch(() => {});
      if (saved) return { id: saved.id };
    } catch { /* Leave the object private when commit status is unknown. */ }
    throw error;
  }
}

Deno.serve(endpoint(async (request, headers) => {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.startsWith("multipart/form-data;")) {
    const userId = await verifiedUser(request, true);
    return json(await uploadPhoto(request, userId!, contentType), 201, headers);
  }

  const body = await readJson(request);
  if (body.action === "shared") {
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(404, "This photo link is unavailable.");
    const photos: Photo[] = await service("order_photo_shared", { token });
    if (!photos.length) throw new HttpError(404, "This photo link is unavailable.");
    return json({ photos: await Promise.all(photos.map(photo => sign(photo, true))) }, 200, headers);
  }

  const userId = await verifiedUser(request, true);
  const scope = { order_id: uuid(body.order_id), user_id: userId };
  if (body.action === "list") {
    const photos: Photo[] = await service("order_photo_list", scope);
    return json({ photos: await Promise.all(photos.map(photo => sign(photo))) }, 200, headers);
  }
  if (body.action === "remove") {
    const result = await service("order_photo_detach", { ...scope, photo_id: uuid(body.photo_id, "Photo ID") });
    if (result.storage_path) await removeObject(result.storage_path).catch(() => {});
    return json({ removed: true }, 200, headers);
  }
  throw new HttpError(400, "Unknown order photo action.");
}));
