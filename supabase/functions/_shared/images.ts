import { HttpError } from "./server.ts";
import { inspectImage } from "../../../assets/ordering/image-format.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function imageType(bytes: Uint8Array, maxBytes = MAX_IMAGE_BYTES): { mime: string; extension: string } {
  if (!bytes.length || bytes.length > maxBytes) throw new HttpError(413, `Choose an image of ${maxBytes / 1024 / 1024} MB or smaller.`);
  try { const {mime,extension} = inspectImage(bytes,{maxBytes}); return {mime,extension}; }
  catch { throw new HttpError(415, "The file contents must be a valid PNG, JPEG, WebP, or HEIC image. PDF, SVG, GIF, and renamed files are not accepted."); }
}
