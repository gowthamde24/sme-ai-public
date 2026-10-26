import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { formatRupeesShort } from "@/lib/money";
import type { PlanOut, ReportRow, TaskContactStatus, TaskLang, TaskStatus } from "@/lib/tasks/types";

import type { Say } from "../words";

/**
 * How a task is written down on the screens (night 4, job DR part B). Pure: the caller gives the words (`t`) and the language. The texts the API makes (a goal, a question, a note, a transcript line) are shown as plain text and
 * never as markup; only the fixed words around them are ours, in the person's language.
 */
const LOCALES: Record<string, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN" };

/** "28 Oct" for an ISO date (the day is the day in India; no time zone shifts it). */
export function dayText(date: string, lang: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] ?? "en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  } catch {
    return date;
  }
}
const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** "28 Oct, 10:00 to 19:00" */
export function whenText(window: PlanOut["window"], t: Say, lang: string): string {
  return t("tk.when", { date: dayText(window.date, lang), from: clock(window.from_minute), to: clock(window.to_minute) });
}

/** The closed English sentences the API adds to a plan, matched to our own words. A sentence we do not know is shown as the API wrote it. */
const NOTES: readonly (readonly [RegExp, string])[] = [
  [/promotional/i, "tk.note.promo"],
  [/unmatched|not in your contacts|did not match/i, "tk.note.unmatched"],
  [/capped|first 500|500/i, "tk.note.capped"],
  [/skipped|stopped|suppress|erased|archived/i, "tk.note.skipped"],
  [/nobody/i, "tk.note.nobody"],
];
export function noteText(note: string, t: Say): string {
  const hit = NOTES.find(([re]) => re.test(note));
  return hit ? t(hit[1]) : note;
}

/** A code of the API ("price_per_bag", "not_interested") as a short phrase for a heading or a cell. */
export const humanize = (code: string): string => code.replace(/_/g, " ").trim();

/** The word for a closed code when we have one (`tk.o.positive`), else the code made readable. */
export function codeText(t: Say, prefix: string, code: string): string {
  const key = `${prefix}.${code}`;
  const text = t(key);
  return text === key ? humanize(code) : text;
}

/** What was captured from one person, as short phrases: an amount question's answer as rupees, the rest as plain text. `amountKeys` = the plan's questions of type amount. */
export function capturedText(row: Pick<ReportRow, "captured">, amountKeys: ReadonlySet<string>): { key: string; value: string }[] {
  return Object.entries(row.captured ?? {})
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => ({ key: humanize(k), value: typeof v === "number" && amountKeys.has(k) ? formatRupeesShort(v) : String(v) }));
}

export const TASK_STATE_WORD: Record<TaskStatus, string> = { needs_answer: "tk.status.needs_answer", planned: "pc.state.planned", approved: "pc.state.approved", running: "pc.state.running", paused: "pc.state.paused", done: "pc.state.done", cancelled: "pc.state.cancelled" };
export const CONTACT_STATE_WORD: Record<TaskContactStatus, string> = { waiting: "tk.cs.waiting", excluded: "tk.cs.excluded", in_progress: "tk.cs.in_progress", done: "tk.cs.done", failed: "tk.cs.failed", skipped: "tk.cs.skipped" };

/** The name of a call language in its own script (the six choices of Settings > AI assistant). */
export const langName = (lang: TaskLang): string => CALL_LANG_NAMES[lang];
