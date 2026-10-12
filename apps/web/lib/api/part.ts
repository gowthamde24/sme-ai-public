import { ApiAuthError } from "./client";
import { kindOf, type FailureKind } from "./failure";

/**
 * One read of a page, on its own (job CC): the page draws what it got, or says in that part's place why it could not (a refused call, a rate limit, an outage), and the rest of the page is untouched. A rejected session is passed on.
 */
export type Part<T> = { ok: true; data: T } | { ok: false; kind: FailureKind; retryAfter?: number };

export async function settle<T>(read: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    const retryAfter = typeof error === "object" && error !== null && "retryAfter" in error && typeof (error as { retryAfter?: unknown }).retryAfter === "number" ? (error as { retryAfter: number }).retryAfter : undefined;
    return { ok: false, kind: kindOf(error), ...(retryAfter !== undefined ? { retryAfter } : {}) };
  }
}
