import type { RetryStep, RuleStep, RuleTemplate } from "@/lib/outreach/types";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** "09:30" from a minute of the day (570). */
export const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * What happens to ONE lead, as steps: the call (now or in n minutes), the retries (the policy's: after 10 minutes, after 2 hours, the next morning at 09:30; all in calling hours), then a WhatsApp template and stop. The API prints the same list on a rule
 * (`plan.steps`); where it does not, the screen builds it from the policy it has, and says only what it knows (no retry steps = no retry line).
 */
export function buildSteps(minutes: number, retrySteps: readonly RetryStep[] | null, missedTemplate: string | null, whatsapp = true): RuleStep[] {
  const steps: RuleStep[] = [{ kind: "call", minutes }];
  for (const r of retrySteps ?? []) steps.push("afterMinutes" in r ? { kind: "retry", afterMinutes: r.afterMinutes } : { kind: "retry", nextMorning: clock(r.nextMorningMinute) });
  if (whatsapp) steps.push({ kind: "whatsapp", template: missedTemplate ?? "missed_call_followup" }); // a "Call only" rule sends nothing (C1, 16 Nov)
  return steps;
}

/** The call, as one phrase: "Call immediately", "Call within 1 minute", "Call within n minutes". */
export function callPhrase(t: Say, minutes: number): string {
  return t(minutes === 0 ? "ol.rule.action.call_now" : minutes === 1 ? "ol.rule.action.call_one" : "ol.rule.action.call_in", { n: minutes });
}

const afterText = (t: Say, minutes: number): string => {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return t(h === 1 ? "ol.plan.after_hour" : "ol.plan.after_hours", { n: h });
  }
  return t(minutes === 1 ? "ol.plan.after_minute" : "ol.plan.after_minutes", { n: minutes });
};

/** The retries as one phrase ("after 10 minutes, then after 2 hours, then next morning at 09:30"), or null when there are none. */
export function retryPhrase(t: Say, steps: readonly RuleStep[]): string | null {
  const parts = steps.flatMap((s) => (s.kind === "retry" ? ["afterMinutes" in s ? afterText(t, s.afterMinutes) : t("ol.plan.next_morning", { time: s.nextMorning })] : []));
  return parts.length > 0 ? parts.reduce((acc, part) => t("ol.plan.join", { a: acc, b: part })) : null;
}

/** The three lines of a rule's plan: the call, the retries (or null), the WhatsApp template (or null) with the label of the template when the list is known. */
export function planLines(t: Say, steps: readonly RuleStep[], templates: readonly RuleTemplate[] | null): { call: string; retry: string | null; whatsapp: string | null } {
  const first = steps.find((s) => s.kind === "call");
  const wa = steps.find((s) => s.kind === "whatsapp");
  const retries = retryPhrase(t, steps);
  const label = wa && wa.kind === "whatsapp" ? templates?.find((x) => x.key === wa.template)?.label : undefined;
  return {
    call: callPhrase(t, first && first.kind === "call" ? first.minutes : 0),
    retry: retries ? t("ol.plan.retry", { steps: retries }) : null,
    whatsapp: wa ? (label ? t("ol.plan.wa", { label }) : t("ol.plan.wa.plain")) : null,
  };
}
