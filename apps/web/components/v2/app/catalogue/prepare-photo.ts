import { MAX_UPLOAD_BYTES, PHOTO_TYPES } from "@/lib/api/catalogue";

/**
 * Getting a picked or taken photo ready (job BC). A phone's camera makes a photo of 3 to 12 MB; the catalogue takes 5 MB and keeps 1280 px, so a big one is shrunk here first (longest side 2048 px,
 * JPEG, on a white ground so a transparent PNG does not turn black), which also makes the upload fast on a mobile connection. A small photo goes as it is. If the browser cannot shrink it (no canvas),
 * the original is sent and the API decides. The metadata (GPS and so on) is dropped by the API either way, and by the canvas here.
 */
export const SHRINK_ABOVE_BYTES = 1_500_000;
export const LONGEST_SIDE = 2048;
export const QUALITY = 0.88;

export type Prepared = { ok: true; blob: Blob } | { ok: false; code: "photo_type_unsupported" | "photo_too_large" };

/** True when the photo should be shrunk before it goes (a big file, or a big picture). */
export const shouldShrink = (bytes: number, width: number, height: number): boolean => bytes > SHRINK_ABOVE_BYTES || Math.max(width, height) > LONGEST_SIDE;

/** The size the shrunk picture has: the longest side at most LONGEST_SIDE, the proportions kept. */
export function shrunkSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LONGEST_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function preparePhoto(file: File): Promise<Prepared> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return { ok: false, code: "photo_type_unsupported" };
  let blob: Blob = file;
  try {
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (shouldShrink(file.size, bitmap.width, bitmap.height)) {
        const { width, height } = shrunkSize(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(bitmap, 0, 0, width, height);
          const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
          if (out && out.size < file.size) blob = out;
        }
      }
      bitmap.close?.();
    }
  } catch {
    // the browser cannot shrink it: send the original; the API decides
  }
  return blob.size > MAX_UPLOAD_BYTES ? { ok: false, code: "photo_too_large" } : { ok: true, blob };
}
