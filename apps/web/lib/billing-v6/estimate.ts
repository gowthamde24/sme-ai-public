import { formatRupeesShort } from "@/lib/money";

/**
 * What a plan of calls will take and cost (C1's `POST /billing/estimate {calls, avg_minutes}`, 13 Nov 2026): `{cost_text, time_text: "about 2 h 30 min of calling", total_minutes, included_minutes_used, enough, shortfall_text}`.
 * The texts are C1's own words (money is theirs to say); the screen shows them as they are. Until the route exists `mockEstimate` makes the same shape from a made-up rate. Money is ₹, never "credits". Pure: no request.
 */
export type Estimate = { costText: string; timeText: string; totalMinutes: number; includedMinutesUsed: number; enough: boolean; shortfallText: string | null };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);

export function parseEstimate(json: unknown): Estimate | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const costText = text(o.cost_text, 60);
  const timeText = text(o.time_text, 80);
  const totalMinutes = whole(o.total_minutes);
  const used = whole(o.included_minutes_used);
  if (costText === null || timeText === null || totalMinutes === null || used === null || typeof o.enough !== "boolean") return null;
  return { costText, timeText, totalMinutes, includedMinutesUsed: used, enough: o.enough, shortfallText: text(o.shortfall_text, 120) };
}

/** "about 45 min of calling", "about 2 h of calling", "about 2 h 30 min of calling". */
export function callingTime(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const part = h === 0 ? `${rest} min` : rest === 0 ? `${h} h` : `${h} h ${rest} min`;
  return `about ${part} of calling`;
}

export type MockTerms = { /** Minutes of the plan not used yet this month. */ includedLeft: number; /** Paise a minute after the included ones. */ ratePaisePerMinute: number; /** The wallet, in paise. */ balancePaise: number };
/** The test plan: Sales assistant, 500 minutes included, then ₹4.50 a minute, a wallet of ₹1,550 (the figures of the owner's final pricing). */
export const MOCK_TERMS: MockTerms = { includedLeft: 500, ratePaisePerMinute: 450, balancePaise: 155_000 };

export function mockEstimate(calls: number, avgMinutes: number, terms: MockTerms = MOCK_TERMS): Estimate {
  const total = Math.ceil(Math.max(0, calls) * Math.max(0, avgMinutes));
  const used = Math.min(total, terms.includedLeft);
  const costPaise = (total - used) * terms.ratePaisePerMinute;
  const enough = costPaise <= terms.balancePaise;
  return { costText: costPaise === 0 ? "Included in your plan" : formatRupeesShort(costPaise), timeText: callingTime(total), totalMinutes: total, includedMinutesUsed: used, enough, shortfallText: enough ? null : `You need ${formatRupeesShort(costPaise - terms.balancePaise)} more` };
}

/** The same shape from a plan the Lead Desk already made (its own estimate of minutes and rupees), for when the estimate route says nothing. */
export function estimateFromPlan(plan: { estimatedMinutes: number; estimatedCostPaise: number }): Estimate {
  return { costText: formatRupeesShort(plan.estimatedCostPaise), timeText: callingTime(plan.estimatedMinutes), totalMinutes: plan.estimatedMinutes, includedMinutesUsed: 0, enough: true, shortfallText: null };
}
