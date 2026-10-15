/**
 * The browser's side of a proof-of-delivery upload (job CO): ONE request to this app's own route (the browser never holds the API's token and may talk to this app only), as an XMLHttpRequest like the catalogue photos
 * (the one other thing that reports progress, and the only way the site's other uploads are made). The body is the photo itself with its own type; `photo_id` makes a second try a replay. The answer is checked, never trusted:
 * `{ ok: true }` or `{ ok: false, code }` with a closed code.
 */
export type ProofResult = { ok: true } | { ok: false; code: string };

export function uploadProof(url: string, receivedBy: string, photoId: string, photo: Blob, type: string): Promise<ProofResult> {
  return new Promise<ProofResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${url}?received_by=${encodeURIComponent(receivedBy)}&photo_id=${encodeURIComponent(photoId)}`);
    xhr.setRequestHeader("Content-Type", type);
    xhr.responseType = "text";
    xhr.onerror = () => resolve({ ok: false, code: "network" });
    xhr.ontimeout = () => resolve({ ok: false, code: "network" });
    xhr.onabort = () => resolve({ ok: false, code: "aborted" });
    xhr.onload = () => resolve(readProofAnswer(xhr.status, xhr.responseText));
    xhr.send(photo);
  });
}

/** The route's answer as a ProofResult. Exported for the tests. */
export function readProofAnswer(status: number, text: string): ProofResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: status === 401 ? "unauthorized" : "bad_answer" };
  }
  if (typeof json !== "object" || json === null) return { ok: false, code: "bad_answer" };
  const body = json as Record<string, unknown>;
  if (status >= 200 && status < 300 && body.ok === true) return { ok: true };
  return { ok: false, code: typeof body.code === "string" && /^[a-z_]{1,40}$/.test(body.code) ? body.code : status === 401 ? "unauthorized" : "bad_answer" };
}
