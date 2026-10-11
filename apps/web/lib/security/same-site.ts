/**
 * A POST from this site only. The session cookie goes along with any request to an address of ours, so a page on another site must not be able to make us act for the signed-in person. True when the browser
 * says the request is same-origin (Sec-Fetch-Site), or the Origin header names this very host.
 */
export function fromThisSite(request: { headers: { get(name: string): string | null } }): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try {
    return origin !== null && host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
