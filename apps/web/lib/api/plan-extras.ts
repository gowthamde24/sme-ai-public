/**
 * What a BIG plan says about who it reaches, who it skips and how much it may do today (the owner's review of 14 Nov; payload names asked of C1 on `confirm_action`). In a file of their own like plan-when.ts: the browser voice reads them too, and turns.ts must not be pulled into the browser bundle.
 * Everything is optional and tolerant: a field that is absent or not usable is simply not drawn, never invented.
 */
/** More than this many people: the card asks a second time ("Really call 255 people?"), whatever the API says. */
export const BIG_PLAN_PEOPLE = 50;

export type PlanAudience = { kind: string; label: string; count: number | null };
export type PlanConsent = { callable: number; skipped: number; /** Names as the API sent them (already masked when it masks), at most 10. */ skippedSample: string[] };
export type PlanDailyCap = { limit: number; used: number; remaining: number };
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
        }
      : null;
  const d = rec(json.daily_cap);
  const dailyCap: PlanDailyCap | null = d && whole(d.limit) !== null && whole(d.used) !== null && whole(d.remaining) !== null ? { limit: d.limit as number, used: d.used as number, remaining: d.remaining as number } : null;
  return { audience, consent, dailyCap, needsSecondConfirm: json.needs_second_confirm === true };
}

/** The second confirmation step: the API says so, or the plan reaches more than BIG_PLAN_PEOPLE people. */
export const needsSecondStep = (p: { count: number | null | undefined; needsSecondConfirm?: boolean }): boolean => p.needsSecondConfirm === true || (p.count ?? 0) > BIG_PLAN_PEOPLE;
