/**
 * "What it will do:" for the standing rules and the call settings (JOBS, the simplicity pass): one made-up example worked out from what is chosen, never a number the API did not give.
 * The example lead writes at 8:15 pm (like the job page's); a lead after the calling hours is called the next morning at the policy's night-call minute, with the thank-you WhatsApp half an hour before it.
 */
export type RuleHours = { fromMinute: number; toMinute: number; nightCallMinute: number };
/** The hours the example uses when the policy is not known (the same defaults as the job page's example). */
export const DEFAULT_RULE_HOURS: RuleHours = { fromMinute: 9 * 60 + 30, toMinute: 19 * 60, nightCallMinute: 9 * 60 + 30 };
export const EXAMPLE_LEAD_AT = 20 * 60 + 15;

export type RuleEffect = { code: "call" | "wa_call"; at: number; wa: number | null; call: number };
export function ruleEffect(withinMinutes: number, whatsapp: boolean, hours: RuleHours | null): RuleEffect {
  const h = hours ?? DEFAULT_RULE_HOURS;
  const at = EXAMPLE_LEAD_AT;
  const inside = at >= h.fromMinute && at < h.toMinute;
  const call = inside ? at + withinMinutes : h.nightCallMinute;
  const wa = whatsapp ? (inside ? at : h.nightCallMinute - 30) : null;
  return { code: whatsapp ? "wa_call" : "call", at, wa, call };
}

/** The calls of one lead that does not answer: the first at `first`, then `count` more, `gap` minutes apart. A call that would fall after the calling hours waits for the next morning (a minute past 1440 = the next day). */
export const EXAMPLE_FIRST_CALL = 10 * 60;
export function retryTimes(count: number, gapMinutes: number, hours: { fromMinute: number; toMinute: number } | null, first = EXAMPLE_FIRST_CALL): number[] {
  const from = hours?.fromMinute ?? 9 * 60;
  const to = hours?.toMinute ?? 21 * 60;
  const out: number[] = [];
  let cur = first;
  for (let i = 0; i < count; i++) {
    cur += gapMinutes;
    const day = Math.floor(cur / 1440);
    const m = cur % 1440;
    if (m >= to) cur = (day + 1) * 1440 + from;
    else if (m < from) cur = day * 1440 + from;
    out.push(cur);
  }
  return out;
}
