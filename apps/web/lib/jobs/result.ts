import type { Vars } from "@/i18n/fill";

import { fmtMinutes } from "./clock";
import { jobResultKey, type JobResult } from "./types";

/**
 * The one result line of a job card (contract section 7): the API sends `result {code, params}` and the web holds the sentence (`jobs.res.<code>`). The codes and their params are FINAL 1.0:
 *   calls_today {called, picked_up, visits}   answered_today {answered, missed, messages}   not_sent_window {count, opens_at}   offer_ready {customers}   reminders_today {sent, confirmed}
 *   search_left {left, per_month, last_search_at}   paused_on {since}   needs_approval {count}   template_needed {count}   minutes_used   no_whatsapp   no_number
 * Dates in params are ISO strings; the web formats them ("12 Nov", "9 am", India time, in English letters so the server and the browser draw the same). A code the web has no sentence for shows the generic line.
 */
export const RESULT_CODES = ["calls_today", "answered_today", "not_sent_window", "offer_ready", "reminders_today", "search_left", "paused_on", "needs_approval", "template_needed", "minutes_used", "no_whatsapp", "no_number"] as const;

const IST_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "12 Nov" (the day in India); "" for a text that is not a date. */
export function fmtDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + IST_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "9 am" / "9:30 pm" (the time in India); "" for a text that is not a date. */
export function fmtClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + IST_MS);
  return fmtMinutes(d.getUTCHours() * 60 + d.getUTCMinutes());
}

/** The numbers and words a result sentence is filled with: the params as they are, with the ISO ones turned into "12 Nov" or "9 am". */
export function resultVars(result: JobResult): Vars {
  const out: Record<string, string | number> = { ...result.params };
  const at = (k: string, f: (iso: string) => string) => {
    const v = result.params[k];
    if (typeof v === "string") out[k] = f(v);
  };
  at("opens_at", fmtClock);
  at("since", fmtDay);
  at("last_search_at", fmtDay);
  return out;
}

/** English only: "1 messages sent" -> "1 message sent" (the sentences hold the plural; a count of exactly one reads singular). The other languages do not mark the plural this way. */
const ONE: Readonly<Record<string, string>> = { calls: "call", messages: "message", reminders: "reminder", customers: "customer", visits: "visit", enquiries: "enquiry", searches: "search", things: "thing" };
export const singular = (text: string): string => text.replace(/(^|[^\d.,])1 (new |store |free )?(calls|messages|reminders|customers|visits|enquiries|searches|things)\b/g, (_m, pre: string, adj: string | undefined, w: string) => `${pre}1 ${adj ?? ""}${ONE[w]}`);

/** The sentence of a result: `jobs.res.<code>`; with exactly one it prefers `jobs.res.<code>.one`; `search_left` with no search yet says so (`.never`); a code with no words is `jobs.res.other`. */
export function resultSentence(t: (key: string, vars?: Vars) => string, result: JobResult): string {
  const vars = resultVars(result);
  const pick = (key: string): string | null => {
    const s = t(key, vars);
    return s === key ? null : s;
  };
  const base = jobResultKey(result.code);
  const count = result.params.count;
  if (result.code === "search_left" && !vars.last_search_at) return singular(pick(`${base}.never`) ?? t("jobs.res.other"));
  if (count === 1) {
    const one = pick(`${base}.one`);
    if (one) return singular(one);
  }
  return singular(pick(base) ?? t("jobs.res.other"));
}
