import { ApiRequestError } from "./client";

/**
 * The answer of the app's own polling routes (nav-counts, notifications, live-calls) when the API could not answer: a plain 503 for the page's poller, and when the API said "busy" with a Retry-After, the same
 * Retry-After, so the poller waits what the API asked (C1's Phase 1, 12 Nov 2026). Never a body from the API.
 */
export function unavailable(error: unknown): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (error instanceof ApiRequestError && error.status === 503 && error.retryAfter !== undefined) headers["Retry-After"] = String(error.retryAfter);
  return new Response("Unavailable", { status: 503, headers });
}
