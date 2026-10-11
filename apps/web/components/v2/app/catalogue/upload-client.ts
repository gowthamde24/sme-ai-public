import { parsePhoto } from "@/lib/api/catalogue";

import type { UploadResult, Uploader } from "./catalogue-types";

/**
 * The browser's side of a photo upload: ONE request to this app's own route (the browser never holds the API's token and may talk to this app only), as an XMLHttpRequest because it is the one thing
 * that reports how much has been sent. The body is the photo itself with its own type; `photo_id` makes a second try a replay. The answer is checked, never trusted.
 */
export function uploaderFor(url: string): Uploader {
  return (file, photoId, onProgress) =>
    new Promise<UploadResult>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${url}?photo_id=${encodeURIComponent(photoId)}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.responseType = "text";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
      xhr.onerror = () => resolve({ ok: false, code: "network" });
      xhr.ontimeout = () => resolve({ ok: false, code: "network" });
      xhr.onabort = () => resolve({ ok: false, code: "aborted" });
      xhr.onload = () => {
        resolve(readAnswer(xhr.status, xhr.responseText));
      };
      xhr.send(file);
    });
}

/** The route's answer as an UploadResult. Exported for the tests. */
export function readAnswer(status: number, text: string): UploadResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: status === 401 ? "unauthorized" : "bad_answer" };
  }
  if (typeof json !== "object" || json === null) return { ok: false, code: "bad_answer" };
  const body = json as Record<string, unknown>;
  if (status >= 200 && status < 300 && body.ok === true && Array.isArray(body.photos) && body.photos.length <= 8) {
    try {
      return { ok: true, photo: parsePhoto(body.photo), photos: body.photos.map(parsePhoto) };
    } catch {
      return { ok: false, code: "bad_answer" };
    }
  }
  return { ok: false, code: typeof body.code === "string" && /^[a-z_]{1,40}$/.test(body.code) ? body.code : status === 401 ? "unauthorized" : "bad_answer" };
}
