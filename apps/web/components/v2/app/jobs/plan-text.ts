import { groupIndian } from "@/lib/money";
import { planChannel, type JobPlan } from "@/lib/jobs/plan";

import type { Say, Words } from "../words";

/** The sentences of a plan card, built from the plan's codes and numbers and the `jobs.new.*` words (the API sends no prose). */
export const hasWord = (words: Words, key: string): boolean => typeof words[key] === "string";

export function hourText(t: Say, h: number): string {
  const hh = h % 24;
  return t(hh < 12 ? "jobs.new.hour.am" : "jobs.new.hour.pm", { h: hh % 12 === 0 ? 12 : hh % 12 });
}

/** "Tomorrow and Saturday", "Monday, Tuesday and Friday": the day codes in words (an unknown code is left out). */
export function daysText(t: Say, words: Words, days: readonly string[]): string {
  const names = days.filter((d) => hasWord(words, `jobs.new.day.${d}`)).map((d) => t(`jobs.new.day.${d}`));
  if (names.length <= 1) return names[0] ?? "";
  return t("jobs.new.and", { a: names.slice(0, -1).join(", "), b: names[names.length - 1] });
}

export function whenText(t: Say, words: Words, p: JobPlan): string {
  const from = hourText(t, p.when.fromHour);
  const to = hourText(t, p.when.toHour);
  if (p.when.days.includes("after_ok")) return t("jobs.new.when.after_ok", { from, to });
  const days = daysText(t, words, p.when.days);
  if (p.when.pacePerHour === 0) return t("jobs.new.when.nopace", { days, from, to });
  return t(planChannel(p) === "call" ? "jobs.new.when.call" : "jobs.new.when.whatsapp", { days, from, to, pace: p.when.pacePerHour });
}

/** The two parts of the Who line: the bold lead and the quiet rest (a basis with no `.more` sentence has none). */
export function whoText(t: Say, words: Words, p: JobPlan): { lead: string; more: string | null } {
  const code = hasWord(words, `jobs.new.who.${p.who.basis.code}`) ? p.who.basis.code : "generic";
  const vars = { ...p.who.basis.params, eligible: p.who.eligible, total: p.who.total };
  return { lead: t(`jobs.new.who.${code}`, vars), more: hasWord(words, `jobs.new.who.${code}.more`) ? t(`jobs.new.who.${code}.more`) : null };
}

/** The cost: bold lead (free minutes, none, or rupees) and the quiet rest (how many calls or messages, and the early-access note). */
export function costText(t: Say, p: JobPlan): { lead: string; more: string } {
  const call = planChannel(p) === "call";
  const n = p.who.eligible;
  const count = t(call ? "jobs.new.cost.calls" : "jobs.new.cost.messages", { n });
  if (p.cost.rupees !== null) return { lead: t("jobs.new.cost.rupees", { rupees: groupIndian(p.cost.rupees) }), more: count };
  if (p.cost.minutes === 0) return { lead: t("jobs.new.cost.none"), more: count };
  return { lead: t("jobs.new.cost.minutes", { minutes: p.cost.minutes, included: p.cost.minutesIncluded }), more: `${count} ${t("jobs.new.cost.early")}` };
}

export const excludedTotal = (p: JobPlan): number => p.who.excluded.reduce((n, e) => n + e.count, 0);
