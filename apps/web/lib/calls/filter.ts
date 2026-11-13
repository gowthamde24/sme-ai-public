import type { CallRow, CallStatusWord } from "@/lib/api/calls";

import { callStatus, callSentence, sentenceText } from "./status";

/**
 * The Calls page's search and filters (design system v6), all in the address so a filtered list can be shared, reloaded and walked back (`?status=&when=&line=&q=&call=`). Pure: given the rows the API sent (the newest 50) it keeps the ones that match.
 * The search looks at what the rows have: the name or number the API shows (`who`), the one-line summary and the outcome sentence. The words said on the call (the transcript) are NOT searched yet: the list does not carry them and the API has no search of its own;
 * the page says so under the box. A search on digits ignores spaces, dashes and a leading +.
 */
export const WHEN_RANGES = ["any", "today", "7d", "30d"] as const;
export type WhenRange = (typeof WHEN_RANGES)[number];
export type CallsQuery = { status: CallStatusWord | "all"; when: WhenRange; line: string | null; q: string };

const STATUS_SET: readonly string[] = ["completed", "transferred", "no_answer", "rejected", "spam", "live"];
const pick = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseCallsQuery(sp: Readonly<Record<string, string | string[] | undefined>>): CallsQuery {
  const status = pick(sp.status);
  const when = pick(sp.when);
  const line = pick(sp.line);
  const q = (pick(sp.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    status: status && STATUS_SET.includes(status) ? (status as CallStatusWord) : "all",
    when: (WHEN_RANGES as readonly string[]).includes(when ?? "") ? (when as WhenRange) : "any",
    line: line && /^[\w-]{1,64}$/.test(line) ? line : null,
    q,
  };
}

/** The address of the Calls page for a query (only what differs from the defaults), optionally with one call open. */
export function callsHref(base: string, query: Partial<CallsQuery>, callId: string | null = null): string {
  const p = new URLSearchParams();
  if (query.status && query.status !== "all") p.set("status", query.status);
  if (query.when && query.when !== "any") p.set("when", query.when);
  if (query.line) p.set("line", query.line);
  if (query.q) p.set("q", query.q);
  const s = p.toString();
  return `${base}/calls${callId ? `/${callId}` : ""}${s ? `?${s}` : ""}`;
}

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
/** The start of today in India (UTC ms), so "Today" means the Indian day whatever the server's clock zone is. */
export const startOfIndiaDay = (now: number): number => Math.floor((now + IST) / DAY) * DAY - IST;

export function inRange(createdAt: string, when: WhenRange, now: number): boolean {
  if (when === "any") return true;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  const today = startOfIndiaDay(now);
  return when === "today" ? t >= today : t >= today - (when === "7d" ? 6 : 29) * DAY;
}

const digits = (s: string): string => s.replace(/\D/g, "");

/** Does one row match the search words? Every word must be found (in the name or number, the summary or the sentence). */
export function matchesSearch(c: CallRow, q: string, w: Readonly<Record<string, string>>, why: (reason: string | null) => string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${c.who} ${c.summaryShort ?? ""} ${sentenceText(callSentence(c), w, why)}`.toLowerCase();
  const hayDigits = digits(c.who);
  return needle.split(" ").every((word) => hay.includes(word) || (digits(word).length >= 3 && hayDigits.includes(digits(word))));
}

/** Everything but the status chip (the chips' counts are of this: "Completed 12" means 12 within the date, number and search the person chose). */
export function narrow(calls: readonly CallRow[], query: CallsQuery, now: number, w: Readonly<Record<string, string>>, why: (reason: string | null) => string): CallRow[] {
  return calls.filter((c) => inRange(c.createdAt, query.when, now) && (!query.line || c.line?.id === query.line) && matchesSearch(c, query.q, w, why));
}

export function byStatus(calls: readonly CallRow[], status: CallStatusWord | "all"): CallRow[] {
  return status === "all" ? [...calls] : calls.filter((c) => callStatus(c) === status);
}

/** The numbers the calls came in on, for the number dropdown (each once, in the order first seen). Empty until the API labels them. */
export function lineOptions(calls: readonly CallRow[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const c of calls) if (c.line && !seen.has(c.line.id)) seen.set(c.line.id, c.line.label);
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** The call the panel shows when the person has not picked one (approved mock): the call that is live, else the newest call, among the rows the filters leave. null when there are none. */
export function defaultCallId(calls: readonly CallRow[], query: CallsQuery, now: number, w: Readonly<Record<string, string>>, why: (reason: string | null) => string): string | null {
  const shown = byStatus(narrow(calls, query, now, w, why), query.status);
  return (shown.find((c) => c.live) ?? shown[0])?.id ?? null;
}

/** The time column (approved mock): "10:22 pm" for a call made today, "12 Nov" for an earlier day (India days); one short line. */
export function shortWhen(iso: string, now: number, lang: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const loc = `${lang}-IN`;
  const opts = { timeZone: "Asia/Kolkata" } as const;
  if (startOfIndiaDay(at) === startOfIndiaDay(now)) return new Intl.DateTimeFormat(loc, { ...opts, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return new Intl.DateTimeFormat(loc, { ...opts, day: "numeric", month: "short" }).format(new Date(at));
}
