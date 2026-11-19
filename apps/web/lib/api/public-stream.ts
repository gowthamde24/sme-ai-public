import { ApiRequestError, apiBaseUrl } from "./client";

// SERVER ONLY, and a file of its own on purpose: lib/api/client.ts is part of the browser's script, so nothing only the server needs may live there (the route-JS ceilings).
/**
 * A GET of a public route whose answer is passed on as it is (a sound, `GET /v1/job-samples/{pack}/{file}`): the raw Response, never read here; no Authorization header and nothing of the person's session, only the closed headers the caller names (a Range). The caller judges the status.
 * A header that does not answer in `timeoutMs` is an ApiRequestError 503 `api_unreachable` (the body, once it starts, is not timed).
 */
export async function apiPublicStream(path: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<Response> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    return await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", method: "GET", headers, signal: control.signal });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  } finally {
    clearTimeout(timer);
  }
}

