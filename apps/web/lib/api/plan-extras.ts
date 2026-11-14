/**
 * What a BIG plan says about who it reaches, who it skips and how much it may do today (the owner's review of 14 Nov; C1's contract docs/contracts/conversation.md, "Plan card, 14 Nov"). In a file of their own like plan-when.ts: the browser voice reads them too, and turns.ts must not be pulled into the browser bundle.
 * Everything is optional and tolerant: a field that is absent or not usable is simply not drawn, never invented.
 */
/** More than this many people: the card asks a second time ("Really call 255 people?"), whatever the API says. */
export const BIG_PLAN_PEOPLE = 50;

export type PlanAudience = { kind: string; label: string; count: number | null };
export type PlanDailyCap = { limit: number; used: number; remaining: number };
export type PlanConsent = { callable: number; skipped: number; /** First names as the API sent them, at most 10. */ skippedSample: string[]; /** Why people are skipped, by closed code ("no_consent": n); kept for later, not drawn. */ reasonCounts: Record<string, number> };
/** The second question on screen is OUR words in the app's language (owner, 14 Nov: chrome follows the app; `second_confirm_text` is not read). `dailyCap` (the business's calls-a-day limit, default 100, editable in Rules) is null until C1 sends it: the limit line is drawn ONLY when it is not null. */
export type PlanExtras = { audience: PlanAudience | null; consent: PlanConsent | null; dailyCap: PlanDailyCap | null; needsSecondConfirm: boolean };

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parsePlanExtras(json: Record<string, unknown>): PlanExtras {
  const a = rec(json.audience);
  const audience: PlanAudience | null = a && typeof a.label === "string" && a.label.trim() !== "" && a.label.length <= 80 ? { kind: typeof a.kind === "string" ? a.kind.slice(0, 40) : "", label: a.label.trim(), count: whole(a.count) } : null;
  const c = rec(json.consent);
  const callable = c ? whole(c.callable) : null;
  const skipped = c ? whole(c.skipped) : null;
  const sample = c && Array.isArray(c.skipped_sample) ? c.skipped_sample : [];
  const consent: PlanConsent | null =
    c && callable !== null && skipped !== null
      ? {
          callable,
          skipped,
          skippedSample: sample
            .map((x) => (typeof x === "string" ? x : (rec(x)?.name ?? null)))
            .filter((x): x is string => typeof x === "string" && x.trim() !== "" && x.length <= 80)
            .slice(0, 10),
          reasonCounts: Object.fromEntries(Object.entries(rec(c.reason_counts) ?? {}).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && whole(v) !== null) as [string, number][]),
        }
      : null;
  const d = rec(json.daily_cap);
  const dailyCap: PlanDailyCap | null = d && whole(d.limit) !== null && whole(d.used) !== null && whole(d.remaining) !== null ? { limit: d.limit as number, used: d.used as number, remaining: d.remaining as number } : null;
  return { audience, consent, dailyCap, needsSecondConfirm: json.needs_second_confirm === true };
}

/** The second confirmation step: the API says so; only when it does not say (the field is absent) the plan reaching more than BIG_PLAN_PEOPLE people is the client's own fallback. */
export const needsSecondStep = (p: { count: number | null | undefined; needsSecondConfirm?: boolean }): boolean => p.needsSecondConfirm === true || (p.count ?? 0) > BIG_PLAN_PEOPLE;
