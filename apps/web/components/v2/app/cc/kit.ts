import type { Say } from "../words";

/**
 * What the screens of job CC share: class strings (the v2 look of the Visits and Today cards), the way a failure kind maps to its sentence in the string store, and the shape of an answer from our own routes.
 * No React and no dictionary here: a client component may import it.
 */
export { card, badge, primary, secondary, quiet, danger, field, label, help, errorLine, okLine } from "../visits/styles";

export const h2 = "font-display text-xl font-bold leading-tight";
export const h3 = "font-display text-lg font-bold leading-tight";
export const sectionGap = "mt-6 flex flex-col gap-6";
export const muted = "text-sm text-muted";
export const monoBox = "break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm [overflow-wrap:anywhere]";
export const selectClass = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";

export type FailureKindWord = "forbidden" | "mfa" | "rate_limited" | "too_big" | "invalid" | "not_found" | "conflict" | "unavailable" | "other";

export const FAILURE_KEY: Record<FailureKindWord, string> = {
  forbidden: "apierr.forbidden",
  mfa: "apierr.mfa",
  rate_limited: "apierr.rate",
  too_big: "apierr.too_big",
  invalid: "apierr.invalid",
  not_found: "apierr.not_found",
  conflict: "apierr.conflict",
  unavailable: "apierr.unavailable",
  other: "apierr.generic",
};

/** A refusal as one of our routes (or a server action) reports it. `error` is already the sentence in the person's language; it can be empty when the route could not be reached at all. */
export interface Failed {
  ok: false;
  kind: FailureKindWord;
  error: string;
  code?: string;
  retryAfter?: number;
  mfa?: boolean;
}
export type Reply<T> = { ok: true; data: T } | Failed;

/** The sentence for a failure: the route's own, else the one for its kind. `own` may give a sentence for a closed code of the screen first. */
export function sentenceOf(f: Failed, t: Say, own?: (code: string) => string | null): string {
  const mine = f.code && own ? own(f.code) : null;
  if (mine) return mine;
  if (f.kind === "rate_limited" && f.retryAfter !== undefined && f.retryAfter <= 300) return t("apierr.rate.n", { n: f.retryAfter });
  return f.error || t(FAILURE_KEY[f.kind]);
}
