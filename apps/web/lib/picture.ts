/** A picture the web hands on to the API (the business logo, a member's photo): JPG, PNG or WebP of at most 5 MB. Checked here before any request and again by the API from the bytes. */
export const PICTURE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** `invalid` = no file, `toobig`, `kind` = another type, else null (fine). */
export function pictureProblem(file: unknown): "invalid" | "toobig" | "kind" | null {
  if (!(file instanceof File) || file.size === 0) return "invalid";
  if (file.size > MAX_PICTURE_BYTES) return "toobig";
  return PICTURE_TYPES.includes(file.type) ? null : "kind";
}
