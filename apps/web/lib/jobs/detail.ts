import { fmtMinutes } from "./clock";
import type { Job, JobParams } from "./types";
import type { JobWho } from "./who";

/**
 * The page of ONE job (JOBS; the contract's JobDetail, FINAL 1.0). The API sends CODES with PARAMS and closed words; the sentences are ours (`jobs.page.*`, `jobs.job.*`, `jobs.line.*`, `jobs.opt.*`, `jobs.finds.*`, `jobs.rd.*`).
 * Everything the screen reads goes through `parseJobDetail` (lib/api/jobs.ts), so a contract change is one parser, not the screen.
 */
export type SettingType = "choice" | "toggle";
/** One choice of the job. `value` is one of `options` (a toggle is a boolean on the wire and "on" or "off" here, so the page's ticks keep one way of saying it); `more` puts it under "More choices" instead of on the main part of the page (the contract's `settings {main, more}`: which list it came in; a Setting has no `area`). */
/** A setting's value when the API sends null: "your own setting" (nothing chosen from the options): the page shows that and selects nothing. */
export const OWN_SETTING = "";
export type JobSetting = { key: string; type: SettingType; /** `OWN_SETTING` ("") when the API sent null. */ value: string; options: readonly string[]; more: boolean };
/** What the customer hears or reads; the API composes it with the real business name and the job's name + the AI disclosure ("Priya, the AI assistant of {business}"). The web only shows it. */
export type JobSays = { language: string; channel: "call" | "whatsapp"; text: string };
/** The month so far (`JobDetail.cost`): the free minutes used of those included, or the rupees on a paid plan (`rupees` not null). */
export type JobCost = { minutesUsed: number; /** null = the plan includes no minutes (Pay as you go). */ minutesIncluded: number | null; rupees: number | null };
export type JobFindsOut = { key: string; enabled: boolean };
export type JobFaq = { id: string; question: string; answer: string };

/** A result row's status: done is green, waiting amber, failed red; the other two are the neutral chip with their own word. */
export const RESULT_STATUSES = ["done", "waiting", "failed", "instead", "noanswer"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export const RESULT_TONE: Record<ResultStatus, "done" | "wait" | "fail" | "info"> = { done: "done", waiting: "wait", failed: "fail", instead: "info", noanswer: "info" };
export type JobResultItem = { customer: string; status: ResultStatus; detailCode: string; params: JobParams; at: string };
export type JobResults = { days: number; numbers: readonly { key: string; value: number }[]; items: readonly JobResultItem[] };
/** A failed job: why (a code with numbers), the people waiting, and the one-tap fix (`job.fix`). */
export type JobFailure = { code: string; params: JobParams; items: readonly { customer: string; detailCode: string; params: JobParams; at: string }[] };
/** Which "Test ... to my phone" a job has: `test_channel` of the contract (a call or a WhatsApp message). The API routes are /test-call and /test-message. */
export type TestChannel = "call" | "whatsapp";
/** The words of the test lines (`jobs.job.test.*`, `jobs.job.try_text.*`) say "message" for a WhatsApp. */
export const testWord = (c: TestChannel): "call" | "message" => (c === "call" ? "call" : "message");

export type JobDetail = {
  job: Job;
  business: string;
  /** The code of the one-sentence "What it does" (`jobs.what.<code>`). */
  whatCode: string;
  says: readonly JobSays[];
  settings: readonly JobSetting[];
  /** The numbers the "What it will do" line is drawn from (for example the time of a made-up enquiry); null = no such line for this job. */
  effectInputs: Readonly<Record<string, string | number>> | null;
  findsOut: readonly JobFindsOut[];
  faqs: readonly JobFaq[];
  results: JobResults;
  failure: JobFailure | null;
  /** Which "Test ... to my phone" button the job has; null = none (a job that does not talk to customers). */
  test: TestChannel | null;
  /** What the month has cost so far: "Used 8 of your 60 free minutes this month" (or rupees). */
  cost: JobCost;
  /** The Who talks card: how this job sounds (language, tone, voice, number); null = the API says nothing, no card. */
  who: JobWho | null;
  /** The shop's OWN WhatsApp message this job sends instead of its default approved one (`JobDetail.message {id, title {en, te?}}`, contract 1.1 part 1, A8); null = the job uses its default. */
  message: JobMessage | null;
  /** The parts of the page the web could not read from the API's answer (left out, each said in plain words on the page): `says`, `settings`, `results`, `faqs`, `cost`, `findsOut`, `failure`, ... Empty = everything was read. */
  unavailable: readonly string[];
};
export type JobMessage = { id: string; title: { en: string; te: string | null } };

/** A name the owner may give: letters (any script), digits, spaces, dots, apostrophes and hyphens; at most 40 characters. Empty = back to the plain name. Nothing else reaches a voice or a message. */
export const JOB_NAME_MAX = 40;
const NAME_OK = /^[\p{L}\p{M}\p{N} .'’-]+$/u;
export type NameCheck = { ok: true; name: string | null } | { ok: false; why: "long" | "chars" };
export function checkJobName(raw: string): NameCheck {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: true, name: null };
  if ([...name].length > JOB_NAME_MAX) return { ok: false, why: "long" };
  if (!NAME_OK.test(name)) return { ok: false, why: "chars" };
  return { ok: true, name };
}

export const FAQ_MAX = 20;
/** An FAQ question and answer: at most 300 characters each (contract section 6). */
export const FAQ_Q_MAX = 300;
export const FAQ_A_MAX = 300;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
export function checkFaq(question: string, answer: string): { ok: true; question: string; answer: string } | { ok: false } {
  const q = question.replace(/\s+/g, " ").trim();
  const a = answer.replace(/[ \t]+/g, " ").trim();
  if (q.length < 3 || q.length > FAQ_Q_MAX || a.length < 1 || a.length > FAQ_A_MAX || CONTROL.test(q) || CONTROL.test(a)) return { ok: false };
  return { ok: true, question: q, answer: a };
}

/* ---- times: "HH:MM" strings the API and the choices speak, shown as "9:30 am" ---- */
export const HOUR_KEYS: readonly string[] = ["from_hour", "to_hour", "send_at"];
export function minutesOf(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export { fmtMinutes };
export const fmtHhmm = (hhmm: string): string => {
  const m = minutesOf(hhmm);
  return m === null ? hhmm : fmtMinutes(m);
};

/**
 * "What it will do": the steps of one made-up example, worked out from the chosen settings (the API sends only its inputs, for example the minute an enquiry came in). Every step is a code with a time; the sentence and the step names are ours.
 * The three steps shown for Call new enquiries: the form, a thank-you WhatsApp, the call. Outside the calling hours the WhatsApp goes at half an hour before the hours start and the call when they start.
 */
export type EffectStep = { code: "form" | "whatsapp" | "call" | "asked" | "followup" | "booked" | "reminder" | "visit"; at: number };
export type Effect = { who: string; steps: readonly EffectStep[] };
const DELAY: Record<string, number> = { right_away: 0, after_5: 5, after_15: 15, after_60: 60 };
const DEFAULT_FROM = 9 * 60 + 30;
const DEFAULT_TO = 19 * 60;

export function effectOf(kind: string, values: Readonly<Record<string, string>>, inputs: Readonly<Record<string, string | number>> | null): Effect | null {
  if (!inputs) return null;
  const who = typeof inputs.who === "string" ? inputs.who : "";
  const at = typeof inputs.event_at === "string" ? (minutesOf(inputs.event_at) ?? 20 * 60 + 15) : 20 * 60 + 15;
  const from = minutesOf(values.from_hour ?? "") ?? DEFAULT_FROM;
  const to = minutesOf(values.to_hour ?? "") ?? DEFAULT_TO;
  if (kind === "speed_to_lead") {
    const delay = DELAY[values.response ?? "right_away"] ?? 0;
    const inside = at >= from && at < to;
    if (inside) return { who, steps: [{ code: "form", at }, { code: "whatsapp", at }, { code: "call", at: at + delay }] };
    return { who, steps: [{ code: "form", at }, { code: "whatsapp", at: from - 30 }, { code: "call", at: from + delay }] };
  }
  if (kind === "followups") return { who, steps: [{ code: "asked", at }, { code: "followup", at: from }, { code: "call", at: from + 30 }] };
  if (kind === "store_visits") {
    // the visit is at `event_at` (a made-up one); the booking came in earlier that day
    const booked = typeof inputs.booked_at === "string" ? (minutesOf(inputs.booked_at) ?? 11 * 60) : 11 * 60;
    const before = values.remind_before ?? "day_before";
    return { who, steps: [{ code: "booked", at: booked }, { code: "reminder", at: before === "hours_3" ? at - 180 : from }, { code: "visit", at }] };
  }
  return null;
}

/** Which of the job's settings shares a sentence with others ("Only between {from_hour} and {to_hour}"): the first key of a group carries the line. Keys not listed here are a line of their own. */
export const LINE_OF: Readonly<Record<string, string>> = { from_hour: "hours", to_hour: "hours" };
export type SettingLine = { id: string; keys: readonly string[] };
export function linesOf(settings: readonly JobSetting[]): SettingLine[] {
  const out: { id: string; keys: string[] }[] = [];
  for (const s of settings) {
    if (s.type === "toggle") {
      out.push({ id: s.key, keys: [s.key] });
      continue;
    }
    const id = LINE_OF[s.key] ?? s.key;
    const found = out.find((l) => l.id === id);
    if (found) found.keys.push(s.key);
    else out.push({ id, keys: [s.key] });
  }
  return out;
}

/** A key or a value the API knows (a closed word): letters, digits and _ . : - only, 1 to 40 characters. The action cannot know every job's options, the API refuses what is not one of them. */
const CODE_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
export const isCode = (v: unknown): v is string => typeof v === "string" && CODE_RE.test(v);

/** "Last run 9 minutes ago": worked out on the server (one clock), then drawn by the page as a code and a number. */
export type Ago = { unit: "now" | "min" | "h" | "d"; n: number };
export function agoOf(iso: string | null, now: number): Ago | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return { unit: "now", n: 0 };
  if (min < 60) return { unit: "min", n: min };
  if (min < 48 * 60) return { unit: "h", n: Math.floor(min / 60) };
  return { unit: "d", n: Math.floor(min / 1440) };
}

/** A moment shown the way the shop says it: "Saturday, 4 pm" (India time, the weekday in the person's language). */
export function whenText(iso: string, lang: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const ist = new Date(t + 330 * 60_000);
  const loc = lang === "te" ? "te-IN" : lang === "hi" ? "hi-IN" : lang === "kn" ? "kn-IN" : "en-IN";
  const day = new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(ist);
  return `${day}, ${fmtMinutes(ist.getUTCHours() * 60 + ist.getUTCMinutes())}`;
}
