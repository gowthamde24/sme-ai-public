import type { ApiRequestError } from "./client";

/**
 * C1's `409 free_minutes_used_up` (the owner's own test call): the body carries `minutes` (the business's monthly free minutes, an integer) and `restarts_on` (the day they start again, a date). They are kept on the refusal as `extra.free`;
 * anything else (a text, a negative number, no date) keeps nothing. SERVER ONLY, loaded from the API client's error path (lib/api/client.ts), so it is never part of a page's script.
 */
export function keepFreeMinutes(error: ApiRequestError, body: unknown): void {
  if (error.code !== "free_minutes_used_up" || typeof body !== "object" || body === null) return;
  const top = body as Record<string, unknown>;
  const inner = typeof top.error === "object" && top.error !== null ? (top.error as Record<string, unknown>) : {};
  const minutes = inner.minutes ?? top.minutes;
  const day = inner.restarts_on ?? top.restarts_on;
  if (typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 && minutes < 100_000 && typeof day === "string" && /^\d{4}-\d{2}-\d{2}/.test(day)) {
    Object.assign(error, { extra: { ...error.extra, free: { minutes, restartsOn: day.slice(0, 10) } } });
  }
}
