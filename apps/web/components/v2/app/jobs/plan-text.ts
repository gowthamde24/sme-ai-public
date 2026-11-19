import { groupIndian } from "@/lib/money";
import { DAY_CODES, planChannel, type ApprovalKind, type DayCode, type JobPlan } from "@/lib/jobs/plan";

import type { Say, Words } from "../words";

/** The sentences of a plan card, built from the plan's codes and numbers and the `jobs.new.*` words (the API sends no prose). */
export const hasWord = (words: Words, key: string): boolean => typeof words[key] === "string";

/** A time of day as the shop says it: "9 am", "9:30 am", "6 pm" (the plan's hours are minutes since midnight; 24:00 reads as "12 am"). */
export function hourText(t: Say, minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return t(h < 12 ? "jobs.new.hour.am" : "jobs.new.hour.pm", { h: m % 60 === 0 ? h12 : `${h12}:${String(m % 60).padStart(2, "0")}` });
}

/** The days of the plan as the shop says them: all seven = "every day"; a run of three or more in a row = "Mon to Sat"; the rest by name ("Mon, Tue and Fri"). The days are the contract's codes (mon..sun), in the order of the week. */
export function daysText(t: Say, days: readonly DayCode[]): string {
  const have = DAY_CODES.filter((d) => days.includes(d));
  if (have.length === 0) return "";
  if (have.length === DAY_CODES.length) return t("jobs.new.when.every_day");
  const groups: DayCode[][] = [];
  for (const d of have) {
    const last = groups[groups.length - 1];
    if (last && DAY_CODES.indexOf(last[last.length - 1]) === DAY_CODES.indexOf(d) - 1) last.push(d);
    else groups.push([d]);
  }
  const names = groups.flatMap((g) => (g.length >= 3 ? [t("jobs.new.when.range", { a: t(`jobs.new.dayshort.${g[0]}`), b: t(`jobs.new.dayshort.${g[g.length - 1]}`) })] : g.map((d) => t(`jobs.new.dayshort.${d}`))));
  if (names.length === 1) return names[0];
  return t("jobs.new.and", { a: names.slice(0, -1).join(", "), b: names[names.length - 1] });
}

/** "Tomorrow, 10 am to 6 pm, Mon to Sat, about 7 calls an hour" (`after_ok` starts "After your OK"): built from `when {start, from, to, days, pace_per_hour}` only. */
export function whenText(t: Say, p: JobPlan): string {
  const w = p.when;
  const parts = [t(`jobs.new.when.start.${w.start}`), t("jobs.new.when.hours", { from: hourText(t, w.fromMin), to: hourText(t, w.toMin) }), daysText(t, w.days)];
  if (w.pacePerHour > 0) parts.push(t(planChannel(p) === "call" ? "jobs.new.when.pace.call" : "jobs.new.when.pace.whatsapp", { pace: w.pacePerHour }));
  return parts.filter((x) => x !== "").join(", ");
}

export { waitingText } from "./waiting-text";

/** The two parts of the Who line, built from the closed `who.basis.code` (enquired_calls, bought_calls, consented_messages, named_list, said_yes_offer, none) and its `{days, count}`: the bold lead and the quiet rest (a basis with no `.more` sentence has none). The plan's `title` is the planner's own text and is never part of it. */
export function whoText(t: Say, words: Words, p: JobPlan): { lead: string; more: string | null } {
  const code = hasWord(words, `jobs.new.who.${p.who.basis.code}`) ? p.who.basis.code : "generic";
  const vars = { ...p.who.basis.params, eligible: p.who.eligible, total: p.who.total };
  // everyone counts ("5 who said yes"), not "5 of the 5"
  const lead = p.who.eligible === p.who.total && hasWord(words, `jobs.new.who.${code}.all`) ? `jobs.new.who.${code}.all` : `jobs.new.who.${code}`;
  return { lead: t(lead, vars), more: hasWord(words, `jobs.new.who.${code}.more`) ? t(`jobs.new.who.${code}.more`) : null };
}

/** What the plan's what-it-finds-out line says: our words for a key, else the API's own line for it (a key with neither is left out). */
export function findsText(t: Say, words: Words, p: JobPlan): string[] {
  return p.findsOut.flatMap((f) => (hasWord(words, `jobs.new.finds.${f.key}`) ? [t(`jobs.new.finds.${f.key}`)] : f.text ? [f.text] : []));
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
