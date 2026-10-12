/**
 * When the bell asks again (job BU). Pure, so the rule can be tested without a clock:
 *  - every minute while the tab is in front and the last answer was good, with a little jitter so many tabs do not ask in the same second;
 *  - after a failure, longer each time (x2, up to ten minutes), and back to a minute after the first good answer;
 *  - a tab that is hidden does not ask at all, unless the person turned on browser notifications: then it asks every five minutes (so a new "needs you" can be announced) and never faster;
 *  - a phone with no connection does not ask.
 */
export const POLL_MS = 60_000;
export const HIDDEN_POLL_MS = 300_000;
export const MAX_BACKOFF_MS = 600_000;
export const JITTER = 0.1;

export interface PollState {
  failures: number;
  hidden: boolean;
  online: boolean;
  browserOptIn: boolean;
}

/** The wait before the next ask in ms, or null for "do not ask now" (the caller asks again when the tab shows or the connection returns). `random` is 0..1. */
export function nextDelay(s: PollState, random: number = Math.random()): number | null {
  if (!s.online) return null;
  if (s.hidden && !s.browserOptIn) return null;
  const base = s.hidden ? HIDDEN_POLL_MS : POLL_MS;
  const backoff = Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(s.failures, 6));
  const wait = s.failures > 0 ? backoff : base;
  return Math.round(wait * (1 + (random * 2 - 1) * JITTER));
}
