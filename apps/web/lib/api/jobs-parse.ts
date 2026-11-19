import { bad, bool, int, list, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";
import { FAQ_A_MAX, FAQ_Q_MAX, RESULT_STATUSES, minutesOf, type JobDetail, type JobFaq, type JobSays, type JobSetting, type TestChannel } from "@/lib/jobs/detail";
import type { JobPlan, PlanBasisCode, Suggestion } from "@/lib/jobs/plan";
import { PLAN_BASES } from "@/lib/jobs/plan";
import { JOB_KINDS, JOB_STATUSES, PLAN_GATES, type Job, type JobParams, type TodayJobs } from "@/lib/jobs/types";

/**
 * THE ADAPTER: every parser of the Jobs contract (C1's FINAL 1.0, contracts/jobs-contract-DRAFT.md sections 1 to 8 and 14) lives in this file, with no request and no mock in it, so the mock fixtures (lib/jobs/fixtures.ts) are parsed by
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
  };
}
export const parseJobs = (json: unknown): Job[] => list(Array.isArray(json) ? json : rec(json, "jobs").items, "jobs", 100).map(parseJob);

/** `GET /jobs/today`: the full Job objects (plan_gate and fix included), what waits for the owner (ids and codes; a row that is not a record is left out) and the main assistant's name. */
export function parseJobsToday(json: unknown): TodayJobs {
  const x = rec(json, "today");
  const waiting = Array.isArray(x.needs_you) ? x.needs_you.slice(0, 200) : [];
  const closed = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : null);
  return {
    jobs: list(x.jobs, "jobs", 100).map(parseJob),
    needsYou: waiting.flatMap((row) => (typeof row === "object" && row !== null && !Array.isArray(row) ? [{ id: closed((row as Record<string, unknown>).id), code: closed((row as Record<string, unknown>).code) }] : [])),
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
/** One Setting `{key, type: choice|toggle, value, options?}` (no `area`: which list it came in says where it goes). A choice's value is one of its options; a toggle's value is on/off (a true/false is read as on/off). */
function parseSetting(row: unknown, more: boolean): JobSetting {
  const x = rec(row, "setting");
  const type = oneOf(x.type ?? "choice", ["choice", "toggle"] as const, "setting.type");
  const key = word(x.key, "setting.key");
  if (type === "toggle") {
    const v = x.value;
    const value = v === true || v === "on" ? "on" : v === false || v === "off" ? "off" : bad("setting.value");
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
  };
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
const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** An hour of the plan's `when`: a whole hour (0 to 24) or "HH:MM" (the settings' own way): minutes since midnight. */
function clockMinutes(v: unknown, what: string): number {
  if (typeof v === "string") {
    if (v === "24:00") return 1440;
    return minutesOf(v) ?? bad(what);
  }
  return int(v, what, 0, 24) * 60;
}
export function parsePlan(json: unknown): JobPlan {
  const x = rec(json, "plan");
  const who = rec(x.who, "who");
  const basis = rec(who.basis, "who.basis");
  const when = rec(x.when, "when");
  const cost = rec(x.cost, "cost");
  const primary = x.primary === undefined ? "start" : oneOf(x.primary, ["start", "send_whatsapp"] as const, "primary");
  const fromMin = clockMinutes(when.from_hour, "when.from_hour");
  const toMin = clockMinutes(when.to_hour, "when.to_hour");
  if (fromMin >= 1440 || toMin < 1) bad("when");
  return {
    planId: word(x.plan_id, "plan_id", 80),
    title: str(x.title ?? "", "title", 160),
    who: {
      basis: { code: oneOf<PlanBasisCode>(basis.code, PLAN_BASES, "who.basis.code"), params: params(basis.params) },
      total: int(who.total, "who.total", 0, 1_000_000),
      eligible: int(who.eligible, "who.eligible", 0, 1_000_000),
      excluded: list(who.excluded ?? [], "who.excluded", 12).map((e) => {
        const r = rec(e, "excluded");
        return { code: word(r.code, "excluded.code"), count: int(r.count, "excluded.count", 0, 1_000_000) };
      }),
    },
    says: list(x.says ?? [], "says", 8).map((s) => {
      const r = rec(s, "says");
      return { language: word(r.language, "says.language", 8), channel: oneOf(r.channel, CHANNELS, "says.channel"), text: str(r.text, "says.text", 1200) };
    }),
    when: {
      fromMin,
      toMin,
      days: list(when.days ?? [], "when.days", 8).map((d) => (typeof d === "number" ? DAY_CODES[int(d, "when.day", 1, 7) - 1] : word(d, "when.day", 20))),
      pacePerHour: int(when.pace_per_hour ?? 0, "when.pace_per_hour", 0, 10_000),
    },
    // `finds_out [{key, text}]`: our own words for a key win; the API's `text` is what a key we have no words for falls back to (a plan lists only what is on)
    findsOut: list(x.finds_out ?? [], "finds_out", 12)
      .map((f) => rec(f, "finds_out"))
      .filter((f) => f.enabled !== false)
      .map((f) => ({ key: word(f.key, "finds_out.key"), text: optStr(f.text, "finds_out.text", 160) })),
    cost: { minutes: int(cost.minutes, "cost.minutes", 0, 1_000_000), minutesIncluded: int(cost.minutes_included, "cost.minutes_included", 0, 1_000_000), minutesUsed: int(cost.minutes_used ?? 0, "cost.minutes_used", 0, 1_000_000), rupees: optInt(cost.rupees, "cost.rupees", 0, 100_000_000) },
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
