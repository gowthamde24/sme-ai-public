import type { Helper, StandupLine } from "@/lib/api/ai-team";
import type { NavCounts } from "@/lib/nav-counts";

/**
 * The stand-up page of app v4 (part 7), as pure parts so they are tested without a screen. Nothing is made up: the steps are the API's own lines, grouped by the helper whose work the line's `source` names; a line whose source is
 * not one helper's (what waits for the owner now, today's first thing) is said by "Everyone". The number of steps is therefore the number of voices that have something to say (the design draws seven; a day with fewer lines has fewer).
 */
export type Reporter = Helper | "everyone";
export type Step = { who: Reporter; text: string; lines: number[] };

/** Which helper a stand-up line belongs to, by the prefix of its source ("yesterday.calls" is the Caller's). An unknown source is everyone's. */
const OWNER: readonly [RegExp, Helper][] = [
  [/^(yesterday|today)\.(calls|call|callbacks)\b/, "caller"],
  [/^yesterday\.(leads|enquiries)\b/, "lead_catcher"],
  [/^(yesterday|today|now)\.(finder|prospects|lead_finder)\b/, "lead_finder"],
  [/^(yesterday|today|now)\.(quotes|quote)\b/, "quote_writer"],
  [/^(yesterday|today)\.(followups|follow_ups)\b/, "followups"],
  [/^yesterday\.(orders|order|money)\b/, "order_desk"],
  [/^yesterday\.(admissions|admission)\b/, "admissions"],
  [/^(yesterday|today)\.(fees|fee)\b/, "fee_reminders"],
  [/^(yesterday|today)\.(notices|notice)\b/, "notices"],
];
export const reporterOf = (source: string): Reporter => OWNER.find(([re]) => re.test(source))?.[1] ?? "everyone";

/** Neighbouring lines of one voice are one step (the Caller says two lines, still one step); the order is the stand-up's own. */
export function buildSteps(lines: readonly StandupLine[]): Step[] {
  const steps: Step[] = [];
  lines.forEach((l, i) => {
    const who = reporterOf(l.source);
    const last = steps[steps.length - 1];
    if (last && last.who === who) {
      last.text = `${last.text} ${l.text}`;
      last.lines.push(i);
    } else steps.push({ who, text: l.text, lines: [i] });
  });
  return steps;
}

/**
 * Where the sound is: `fraction` (0 to 1 of the audio) says which step is being read and how far into it. The sound is one recording, so the split is by the length of the words (a step of more letters takes longer): an estimate,
 * only used to follow the text with the eye, never to decide anything.
 */
export function stepAt(steps: readonly Step[], fraction: number): { index: number; within: number } {
  if (steps.length === 0) return { index: 0, within: 0 };
  const f = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
  const total = steps.reduce((n, s) => n + s.text.length, 0) || 1;
  let from = 0;
  for (let i = 0; i < steps.length; i++) {
    const len = steps[i].text.length;
    const to = from + len / total;
    if (f < to || i === steps.length - 1) return { index: i, within: len ? Math.min(1, Math.max(0, (f - from) / (len / total))) : 0 };
    from = to;
  }
  return { index: steps.length - 1, within: 1 };
}

/** The text of a step as words and spaces (so each word can be marked and the spaces stay as they were), and which word is being read at `within` (0 to 1). */
export function wordsOf(text: string): string[] {
  return text.split(/(\s+)/).filter((p) => p !== "");
}
export function wordAt(parts: readonly string[], within: number): number {
  const words = parts.map((p, i) => ({ p, i })).filter((x) => !/^\s+$/.test(x.p));
  if (words.length === 0) return -1;
  const chars = words.reduce((n, x) => n + x.p.length, 0) || 1;
  let seen = 0;
  for (const x of words) {
    seen += x.p.length;
    if (within * chars < seen) return x.i;
  }
  return words[words.length - 1].i;
}

/** "Tomorrow's to do": what waits for the owner now, from the same counts that draw the menu's chips (nothing else, nothing guessed). A count that is null or 0 is not a card. */
export type TodoKey = "quotes" | "finder" | "chats" | "followups" | "visits";
export type Todo = { key: TodoKey; n: number; href: string };
export function todoCards(counts: NavCounts | null, base: string, offer: { finder: boolean }): Todo[] {
  if (!counts) return [];
  const out: Todo[] = [];
  const add = (key: TodoKey, n: number | null, href: string) => {
    if (n !== null && n > 0) out.push({ key, n, href });
  };
  add("quotes", counts.quotesWaiting, `${base}/quotes`);
  if (offer.finder) add("finder", counts.prospectsNeedingOwner, `${base}/retailers`);
  add("chats", counts.unreadChats, `${base}/chats`);
  add("followups", counts.followupsDue, `${base}/followups`);
  add("visits", counts.visitsToday, `${base}/visits`);
  return out;
}

/** The days before `date` that an "Earlier reports" list asks for (newest first), as yyyy-mm-dd. */
export function earlierDates(date: string, n: number): string[] {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t - (i + 1) * 86_400_000).toISOString().slice(0, 10));
}

/** "Thu, 5 November" in the person's language (the day itself, in UTC, so the browser's own zone never moves it). */
export function dayWords(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00Z`));
}
