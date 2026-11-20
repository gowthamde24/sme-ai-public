import { bad, bool, int, iso, list, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";
import { FAQ_A_MAX, FAQ_Q_MAX, RESULT_STATUSES, minutesOf, type JobCost, type JobDetail, type JobFaq, type JobMessage, type JobSays, type JobSetting, type TestChannel } from "@/lib/jobs/detail";
import type { ExcludedCode, JobPlan, PlanBasisCode, PlanCost, PlanSearch, Suggestion } from "@/lib/jobs/plan";
import { DAY_CODES, EXCLUDED_CODES, PLAN_BASES, WHEN_STARTS } from "@/lib/jobs/plan";
import { SEARCH_AREA_MAX } from "@/lib/jobs/plan-const";
import { WHO_LANGUAGES, WHO_NUMBERS, WHO_TONES, WHO_VOICES, type JobWho, type WhoNumberInfo } from "@/lib/jobs/who";
import { JOB_KINDS, JOB_STATUSES, NEEDS_TARGETS, PLAN_GATES, type Job, type JobParams, type JobSpeaks, type NeedsYouItem, type TodayJobs } from "@/lib/jobs/types";

/**
 * THE ADAPTER: every parser of the Jobs contract (C1's FINAL 1.0, contracts/jobs-contract-DRAFT.md sections 1 to 8, 14 and 15) lives in this file, with no request and no mock in it, so the mock fixtures (lib/jobs/fixtures.ts) are parsed by
 * exactly the code that parses the API (test: lib/jobs/fixtures.test.ts). `lib/api/jobs.ts` re-exports them and makes the calls. A contract change is an edit here. Anything the web has no word for is an ApiContractError, never drawn.
 */
const CHANNELS = ["call", "whatsapp"] as const;
const TEST_CHANNELS = ["call", "whatsapp"] as const satisfies readonly TestChannel[];

/** Params of a result or a why: closed names to numbers or short words. A null or a boolean is simply not there (for example `last_search_at` before the first search). */
export function params(v: unknown): JobParams {
  const x = rec(v ?? {}, "params");
  const out: Record<string, string | number> = {};
  for (const [k, p] of Object.entries(x).slice(0, 12)) {
    if (p === null || typeof p === "boolean") continue;
    out[word(k, "param")] = typeof p === "number" && Number.isFinite(p) ? p : str(p, "param", 80);
  }
  return out;
}

/**
 * `speaks {language, voice, number}` of a job (C1 contract 1.1, assumed: see jobs-templates-web-needs.md): closed words and a short voice name; absent = nothing to show. It is an extra of a row, so it is LENIENT like `parseWho`: a value the web has no word for
 * (a long word, a number where a word is expected, a speaks that is not an object) is simply not shown (null), never an error that would take the whole jobs list (and Today's "Running now") down with it.
 */
export function parseSpeaks(v: unknown): JobSpeaks | null {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const opt = (k: string, max: number, closed: boolean): string | null => {
    if (x[k] === null || x[k] === undefined) return null;
    try {
      return closed ? word(x[k], `speaks.${k}`, max) : str(x[k], `speaks.${k}`, max);
    } catch {
      return null;
    }
  };
  // `voice` is the catalogue id and `voice_name` the owner's word for it; an odd value is null, never a throw. The number is only the shop's (the second number is not a product): any other word reads as the shop's own (null).
  const number = opt("number", 20, true);
  return { language: opt("language", 12, true), voice: opt("voice", 40, false), voiceName: opt("voice_name", 40, false), number: number === "shop" ? number : null };
}

/* ---- a job (section 1) ---- */
export function parseJob(json: unknown): Job {
  const x = rec(json, "job");
  const r = rec(x.result, "result");
  const fix = x.fix === null || x.fix === undefined ? null : rec(x.fix, "fix");
  const gate = x.plan_gate === null || x.plan_gate === undefined ? null : rec(x.plan_gate, "plan_gate");
  return {
    id: uuid(x.id, "id"),
    kind: oneOf(x.kind, JOB_KINDS, "kind"),
    customName: x.custom_name === null || x.custom_name === undefined ? null : str(x.custom_name, "custom_name", 40),
    enabled: bool(x.enabled, "enabled"),
    status: oneOf(x.status, JOB_STATUSES, "status"),
    result: { code: word(r.code, "result.code"), params: params(r.params) },
    needsYou: int(x.needs_you ?? 0, "needs_you", 0, 1_000_000),
    lastRunAt: optIso(x.last_run_at, "last_run_at"),
    fix: fix ? { code: word(fix.code, "fix.code"), count: int(fix.count, "fix.count", 0, 1_000_000) } : null,
    planGate: gate ? oneOf(gate.code, PLAN_GATES, "plan_gate.code") : null,
    ...(x.speaks !== undefined ? { speaks: parseSpeaks(x.speaks) } : {}),
  };
}
export const parseJobs = (json: unknown): Job[] => list(Array.isArray(json) ? json : rec(json, "jobs").items, "jobs", 100).map(parseJob);

/** One item of what waits for the owner: `{id, code, kind, at, target {type, id}}`, closed (Today uses only the count; its own list draws the cards). */
function parseNeedsYou(row: unknown): NeedsYouItem {
  const x = rec(row, "needs_you item");
  const target = rec(x.target, "needs_you.target");
  return { id: word(x.id, "needs_you.id", 80), code: word(x.code, "needs_you.code", 80), kind: word(x.kind, "needs_you.kind", 80), at: iso(x.at, "needs_you.at"), target: { type: oneOf(target.type, NEEDS_TARGETS, "needs_you.target.type"), id: word(target.id, "needs_you.target.id", 80) } };
}

/** `GET /jobs/today`: the full Job objects (plan_gate and fix included), what waits for the owner and the main assistant's name. */
export function parseJobsToday(json: unknown): TodayJobs {
  const x = rec(json, "today");
  return {
    jobs: list(x.jobs, "jobs", 100).map(parseJob),
    needsYou: list(x.needs_you ?? [], "needs_you", 200).map(parseNeedsYou),
    assistantName: x.assistant === null || x.assistant === undefined ? null : optStr(rec(x.assistant, "assistant").name, "assistant.name", 60),
  };
}

/* ---- the page of one job (sections 1, 3 and 7) ---- */
export function parseSays(v: unknown): JobSays[] {
  return list(v ?? [], "says", 12).map((row) => {
    const x = rec(row, "says");
    return { language: word(x.language, "says.language", 12), channel: oneOf(x.channel, CHANNELS, "says.channel"), text: str(x.text, "says.text", 1000) };
  });
}
/** One Setting `{key, type: choice|toggle, value, options?}` (no `area`: which list it came in says where it goes). A choice's value is one of its options; a toggle has no options and its value is a BOOLEAN on the wire (the page keeps "on"/"off" for its ticks). */
function parseSetting(row: unknown, more: boolean): JobSetting {
  const x = rec(row, "setting");
  const type = oneOf(x.type ?? "choice", ["choice", "toggle"] as const, "setting.type");
  const key = word(x.key, "setting.key");
  if (type === "toggle") {
    const value = bool(x.value, "setting.value") ? "on" : "off";
    return { key, type, value, options: ["on", "off"], more };
  }
  const options = list(x.options, "setting.options", 40).map((o) => word(o, "option", 40));
  const value = word(x.value, "setting.value", 40);
  if (!options.includes(value)) bad("setting.value");
  return { key, type, value, options, more };
}
/** `settings {main: [Setting], more: [Setting]}`: at most 4 in `main` by the contract (the web draws what it is given: a bigger list is C1's to answer for, the fixtures test holds the fixtures to 4). */
function parseSettings(v: unknown): JobSetting[] {
  const s = rec(v ?? {}, "settings");
  return [...list(s.main ?? [], "settings.main", 12).map((row) => parseSetting(row, false)), ...list(s.more ?? [], "settings.more", 30).map((row) => parseSetting(row, true))];
}

/** `GET /jobs/{id}`: everything of the page in one call. */
export function parseJobDetail(json: unknown): JobDetail {
  const x = rec(json, "job");
  const what = rec(x.what_it_does ?? { code: "custom" }, "what_it_does");
  const effect = x.effect === null || x.effect === undefined ? null : rec(x.effect, "effect");
  const results = rec(x.results ?? {}, "results");
  const failure = x.failure === null || x.failure === undefined ? null : rec(x.failure, "failure");
  const item = (row: unknown) => {
    const r = rec(row, "item");
    return { customer: str(r.customer, "item.customer", 80), detailCode: word(r.detail_code, "item.detail_code"), params: params(r.params), at: optIso(r.at, "item.at") ?? "" };
  };
  return {
    job: parseJob(x),
    business: str(x.business_name, "business_name", 80),
    whatCode: word(what.code, "what_it_does.code"),
    says: parseSays(x.says),
    settings: parseSettings(x.settings),
    effectInputs: effect ? params(effect.inputs) : null,
    findsOut: list(x.finds_out ?? [], "finds_out", 30).map((row) => {
      const r = rec(row, "finds_out");
      return { key: word(r.key, "finds_out.key"), enabled: bool(r.enabled, "finds_out.enabled") };
    }),
    faqs: list(x.faqs ?? [], "faqs", 100).map(parseFaq),
    results: {
      days: int(results.days ?? 7, "results.days", 1, 365),
      // `numbers {key: n}`; the researcher's free-search state sits here too (`last_search_at` is a date, `weekly` a flag): only whole numbers are numbers
      numbers: Object.entries(rec(results.numbers ?? {}, "results.numbers"))
        .filter(([, value]) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000)
        .slice(0, 6)
        .map(([key, value]) => ({ key: word(key, "number"), value: value as number })),
      items: list(results.items ?? [], "results.items", 50).map((row) => ({ ...item(row), status: oneOf(rec(row, "item").status, RESULT_STATUSES, "item.status") })),
    },
    failure: failure ? { code: word(failure.code, "failure.code"), params: params(failure.params), items: list(failure.items ?? [], "failure.items", 50).map(item) } : null,
    test: x.test_channel === null || x.test_channel === undefined ? null : oneOf(x.test_channel, TEST_CHANNELS, "test_channel"),
    cost: parseJobCost(x.cost),
    who: parseWho(x.speaks, x.numbers),
    message: parseJobMessage(x.message),
  };
}

/**
 * `JobDetail.speaks {language, tone, voice, voice_name, number: shop}` and the workspace's `numbers [{key: shop, masked}]` (C1 contract 1.1 part 1, section 4 C1 and section 1 item 10): the Who talks card. The card is an extra, so a word the web does not know (a fourth voice, another language) draws no card instead of breaking the page: null.
 */
export function parseWho(speaks: unknown, numbers: unknown): JobWho | null {
  if (speaks === null || speaks === undefined || typeof speaks !== "object" || Array.isArray(speaks)) return null;
  const s = speaks as Record<string, unknown>;
  const closed = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
  const language = closed(s.language, WHO_LANGUAGES);
  const tone = closed(s.tone, WHO_TONES);
  const voice = closed(s.voice, WHO_VOICES);
  if (!language || !tone || !voice) return null;
  // `voice_name` always comes with the voice (the API fills it from the catalogue); a name that is not short plain text is simply not used. The number is only ever the shop's: a word the web does not know (a second number) reads as it.
  const voiceName = typeof s.voice_name === "string" && /^[\p{L}\p{M}\p{N} .'’-]{1,40}$/u.test(s.voice_name) ? s.voice_name : null;
  const number = closed(s.number, WHO_NUMBERS) ?? "shop";
  const rows = Array.isArray(numbers) ? numbers.slice(0, 4) : [];
  const known: WhoNumberInfo[] = [];
  for (const r of rows) {
    const key = r && typeof r === "object" ? closed((r as Record<string, unknown>).key, WHO_NUMBERS) : null;
    const masked = r && typeof r === "object" ? (r as Record<string, unknown>).masked : null;
    if (key && typeof masked === "string" && /^[+0-9 xX*•-]{4,24}$/.test(masked) && !known.some((k) => k.key === key)) known.push({ key, masked });
  }
  return { language, tone, voice, voiceName, number, numbers: known };
}
/**
 * `JobDetail.message {id, title {en, te?}} | null` (C1 contract 1.1 part 1, A8): the own message the job sends. An extra of the page, so LENIENT: absent, null or anything that is not a short id and a plain title is null (the page then says nothing), never an error.
 */
export function parseJobMessage(v: unknown): JobMessage | null {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return null;
  const x = v as Record<string, unknown>;
  const t = x.title;
  if (typeof x.id !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(x.id) || t === null || typeof t !== "object" || Array.isArray(t)) return null;
  const en = (t as Record<string, unknown>).en;
  const te = (t as Record<string, unknown>).te;
  if (typeof en !== "string" || en.trim() === "" || en.length > 60) return null;
  return { id: x.id, title: { en: en.trim(), te: typeof te === "string" && te.trim() !== "" && te.length <= 60 ? te.trim() : null } };
}
/** `JobDetail.cost {minutes_used, minutes_included, rupees|null}`: the month so far (the plan card's `cost` is the per-plan estimate, see parsePlan). */
function parseJobCost(v: unknown): JobCost {
  const c = rec(v, "cost");
  return { minutesUsed: int(c.minutes_used, "cost.minutes_used", 0, 1_000_000), minutesIncluded: int(c.minutes_included, "cost.minutes_included", 0, 1_000_000), rupees: optInt(c.rupees, "cost.rupees", 0, 100_000_000) };
}
/** An FAQ: the question and the answer are at most 300 characters each (the owner's own text). */
export function parseFaq(row: unknown): JobFaq {
  const r = rec(row, "faq");
  return { id: word(r.id, "faq.id", 80), question: str(r.question, "faq.question", FAQ_Q_MAX), answer: str(r.answer, "faq.answer", FAQ_A_MAX) };
}

/** `POST /jobs/{id}/test-call` and `/test-message`: `{placed: true, minutes_used: n}`, n being the estimate counted against the free minutes (a call 1, a message 0). */
export function parseTested(json: unknown): { placed: true; minutesUsed: number } {
  const x = rec(json, "test answer");
  if (x.placed !== true) bad("placed");
  return { placed: true, minutesUsed: int(x.minutes_used ?? 0, "minutes_used", 0, 10_000) };
}

/* ---- plans and suggestions (sections 4 and 5) ---- */
/** `Plan.when {start, from, to, days, pace_per_hour}`: `start` is today | tomorrow | after_ok, `from` and `to` are "HH:MM", `days` is a list of mon..sun codes (the API expands its own shorthands; the answer always lists the days). Nothing else is read. */
function parseWhen(v: unknown): JobPlan["when"] {
  const when = rec(v, "when");
  const clock = (c: unknown, what: string): number => minutesOf(str(c, what, 5)) ?? bad(what);
  return {
    start: oneOf(when.start, WHEN_STARTS, "when.start"),
    fromMin: clock(when.from, "when.from"),
    toMin: clock(when.to, "when.to"),
    days: list(when.days ?? [], "when.days", 7).map((d) => oneOf(d, DAY_CODES, "when.day")),
    pacePerHour: int(when.pace_per_hour ?? 0, "when.pace_per_hour", 0, 10_000),
  };
}
/**
 * `Plan.cost` (contract 1.1 part 1, T9 and T12): `{minutes, minutes_included, minutes_used?, rupees|null}`, plus `messages {count, rupees|null, included}|null` for the WhatsApp part, and `searches {left, per_month}` on a Lead Finder plan (which has no call minutes: they read 0).
 * A plan with neither the minutes nor `searches` is not the contract's shape.
 */
function parsePlanCost(v: unknown): PlanCost {
  const cost = rec(v, "cost");
  const searches = cost.searches === undefined || cost.searches === null ? null : rec(cost.searches, "cost.searches");
  const messages = cost.messages === undefined || cost.messages === null ? null : rec(cost.messages, "cost.messages");
  const minutes = (key: string): number => (searches && (cost[key] === undefined || cost[key] === null) ? 0 : int(cost[key], `cost.${key}`, 0, 1_000_000));
  return {
    minutes: minutes("minutes"),
    minutesIncluded: minutes("minutes_included"),
    minutesUsed: int(cost.minutes_used ?? 0, "cost.minutes_used", 0, 1_000_000),
    rupees: optInt(cost.rupees, "cost.rupees", 0, 100_000_000),
    // present only when the API sent them (a plan with neither is exactly the plan of 1.0)
    ...(messages ? { messages: { count: int(messages.count, "cost.messages.count", 0, 1_000_000), rupees: optInt(messages.rupees, "cost.messages.rupees", 0, 100_000_000), included: bool(messages.included, "cost.messages.included") } } : {}),
    ...(searches ? { searches: { left: int(searches.left, "cost.searches.left", 0, 100_000), perMonth: int(searches.per_month, "cost.searches.per_month", 0, 100_000) } } : {}),
  };
}
/** `Plan.search {area, results, fit_bar}` of a Lead Finder plan: the area is the owner's own words (at most 60 characters), `results` is 5, 10 or 20 and `fit_bar` 50 to 100. null = not a search plan. */
function parsePlanSearch(v: unknown): PlanSearch | null {
  if (v === undefined || v === null) return null;
  const s = rec(v, "search");
  if (s.results !== 5 && s.results !== 10 && s.results !== 20) bad("search.results");
  return { area: str(s.area, "search.area", SEARCH_AREA_MAX), results: s.results, fitBar: int(s.fit_bar, "search.fit_bar", 50, 100) };
}
export function parsePlan(json: unknown): JobPlan {
  const x = rec(json, "plan");
  const who = rec(x.who, "who");
  const basis = rec(who.basis, "who.basis");
  const primary = x.primary === undefined ? "start" : oneOf(x.primary, ["start", "send_whatsapp"] as const, "primary");
  return {
    planId: word(x.plan_id, "plan_id", 80),
    title: str(x.title ?? "", "title", 160),
    who: {
      basis: { code: oneOf<PlanBasisCode>(basis.code, PLAN_BASES, "who.basis.code"), params: params(basis.params) },
      total: int(who.total, "who.total", 0, 1_000_000),
      eligible: int(who.eligible, "who.eligible", 0, 1_000_000),
      excluded: list(who.excluded ?? [], "who.excluded", 12).map((e) => {
        const r = rec(e, "excluded");
        return { code: oneOf<ExcludedCode>(r.code, EXCLUDED_CODES, "excluded.code"), count: int(r.count, "excluded.count", 0, 1_000_000) };
      }),
    },
    says: list(x.says ?? [], "says", 8).map((s) => {
      const r = rec(s, "says");
      return { language: word(r.language, "says.language", 8), channel: oneOf(r.channel, CHANNELS, "says.channel"), text: str(r.text, "says.text", 1200) };
    }),
    when: parseWhen(x.when),
    // `finds_out [{key, text}]`: our own words for a key win; the API's `text` is what a key we have no words for falls back to (a plan lists only what is on)
    findsOut: list(x.finds_out ?? [], "finds_out", 12)
      .map((f) => rec(f, "finds_out"))
      .filter((f) => f.enabled !== false)
      .map((f) => ({ key: word(f.key, "finds_out.key"), text: optStr(f.text, "finds_out.text", 160) })),
    cost: parsePlanCost(x.cost),
    ...(x.search === undefined || x.search === null ? {} : { search: parsePlanSearch(x.search) }),
    primary,
    alternatives: list(x.alternatives ?? [], "alternatives", 4).map((a) => {
      const r = rec(a, "alternative");
      return { kind: oneOf(r.kind, ["whatsapp"] as const, "alternative.kind"), count: int(r.count, "alternative.count", 0, 1_000_000) };
    }),
    blockers: list(x.blockers ?? [], "blockers", 8).map((b) => word(rec(b, "blocker").code, "blocker.code")),
    expiresInMinutes: optInt(x.expires_in_minutes, "expires_in_minutes", 1, 10_080),
  };
}
export function parseSuggestions(json: unknown): Suggestion[] {
  return list(Array.isArray(json) ? json : rec(json, "suggestions").items, "suggestions", 8).map((s) => {
    const x = rec(s, "suggestion");
    const why = rec(x.why, "why");
    const title = x.title === null || x.title === undefined ? null : { code: word(rec(x.title, "title").code, "title.code") };
    return { kind: oneOf(x.kind, JOB_KINDS, "kind"), title, why: { code: word(why.code, "why.code"), params: params(why.params) }, preview: str(x.preview, "preview", 600), ready: x.ready === undefined ? true : bool(x.ready, "ready") };
  });
}
export const parseSuggestionHeading = (json: unknown): string | null => (!Array.isArray(json) && rec(json, "suggestions").heading ? word(rec(json, "suggestions").heading, "heading", 20) : null);
