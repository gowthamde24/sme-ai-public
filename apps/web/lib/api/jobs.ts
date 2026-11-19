import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, oneOf, optInt, optIso, rec, str, uuid, word } from "./shape";
import { JOB_KINDS, JOB_STATUSES, type Job, type JobKind, type JobParams, type JobSwitched } from "@/lib/jobs/types";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import type { JobPlan, JobStarted, JobTested, PlanChannel, PlanInput, Suggestion, SuggestionList } from "@/lib/jobs/plan";
import { PLAN_TEXT_MAX, PLAN_TEXT_MIN } from "@/lib/jobs/plan";
import { mockPlan, mockStartPlan, mockStartedFor, mockSuggestions, mockTest } from "@/lib/jobs/plan-mock";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * The jobs of a workspace (JOBS; contracts/jobs-web-needs.md, C1's contract draft is the final word). SERVER ONLY, with the signed-in person's own token. Every answer goes through lib/api/shape.ts: closed words (kind, status), bounded numbers and
 * strings; anything else is an ApiContractError, never drawn. With JOBS=mock the made-up jobs of lib/jobs/mock.ts answer and nothing leaves the server.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};

function params(v: unknown): JobParams {
  const x = rec(v ?? {}, "params");
  const out: Record<string, string | number> = {};
  for (const [k, p] of Object.entries(x).slice(0, 12)) out[word(k, "param")] = typeof p === "number" && Number.isFinite(p) ? p : str(p, "param", 80);
  return out;
}
export function parseJob(json: unknown): Job {
  const x = rec(json, "job");
  const r = rec(x.result, "result");
  const fix = x.fix === null || x.fix === undefined ? null : rec(x.fix, "fix");
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
  };
}
export const parseJobs = (json: unknown): Job[] => list(Array.isArray(json) ? json : rec(json, "jobs").items, "jobs", 100).map(parseJob);

/** `GET /jobs`; null when the screens are off or the API does not have jobs yet (the part is then simply not drawn). */
export async function readJobs(token: string, tenantId: string): Promise<Job[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return [...MOCK_JOBS];
  try {
    return parseJobs(await apiRequest(`${base(tenantId)}/jobs`, token));
  } catch {
    return null;
  }
}

/** `PATCH /jobs/{id}` `{enabled}`: the switch. With JOBS=mock the answer is made up from the job's own state. */
export async function setJobEnabled(token: string, tenantId: string, jobId: string, enabled: boolean): Promise<JobSwitched> {
  if (!isCanonicalUuid(jobId)) bad("job id");
  if (jobsScreens() === "mock") {
    const j = MOCK_JOBS.find((m) => m.id === jobId);
    return { id: jobId, enabled, status: enabled ? (j && j.status !== "paused" ? j.status : "running") : "paused" };
  }
  const j = parseJob(await apiRequest(`${base(tenantId)}/jobs/${jobId}`, token, { method: "PATCH", body: JSON.stringify({ enabled }) }));
  return { id: j.id, enabled: j.enabled, status: j.status };
}

/* ---- Start a job by saying it, and the suggested jobs (needs doc sections 4 and 5). THE ADAPTER: when C1's contract differs, only the parsers below and the paths in the five functions change. ---- */
const CHANNELS = ["call", "whatsapp"] as const;
const planPath = (tenantId: string, planId: string, tail: string): string => `${base(tenantId)}/jobs/plan/${encodeURIComponent(word(planId, "plan id", 80))}/${tail}`;

export function parsePlan(json: unknown): JobPlan {
  const x = rec(json, "plan");
  const who = rec(x.who, "who");
  const basis = rec(who.basis, "who.basis");
  const when = rec(x.when, "when");
  const cost = rec(x.cost, "cost");
  const primary = x.primary === undefined ? "start" : oneOf(x.primary, ["start", "send_whatsapp"] as const, "primary");
  return {
    planId: word(x.plan_id, "plan_id", 80),
    title: str(x.title ?? "", "title", 160),
    who: {
      basis: { code: word(basis.code, "who.basis.code"), params: params(basis.params) },
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
      fromHour: int(when.from_hour, "when.from_hour", 0, 23),
      toHour: int(when.to_hour, "when.to_hour", 1, 24),
      days: list(when.days ?? [], "when.days", 8).map((d) => word(d, "when.day", 20)),
      pacePerHour: int(when.pace_per_hour ?? 0, "when.pace_per_hour", 0, 10_000),
    },
    findsOut: list(x.finds_out ?? [], "finds_out", 12)
      .map((f) => rec(f, "finds_out"))
      .filter((f) => f.enabled !== false)
      .map((f) => word(f.key, "finds_out.key")),
    cost: { minutes: int(cost.minutes, "cost.minutes", 0, 1_000_000), minutesIncluded: int(cost.minutes_included, "cost.minutes_included", 0, 1_000_000), rupees: optInt(cost.rupees, "cost.rupees", 0, 100_000_000) },
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
const parseStarted = (json: unknown): JobStarted => {
  const x = rec(json, "started");
  return { jobId: uuid(x.job_id ?? x.id, "job_id") };
};

/** What may be asked of the planner: the owner's sentence (3 to 500 characters), or a suggested job's kind; `as: "whatsapp"` asks for the WhatsApp version of the same plan. */
export function checkPlanInput(input: PlanInput): PlanInput {
  if ("kind" in input) return { kind: oneOf(input.kind, JOB_KINDS, "kind") };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < PLAN_TEXT_MIN || text.length > PLAN_TEXT_MAX) bad("text");
  return input.as === "whatsapp" ? { text, as: "whatsapp" } : { text };
}

/** `POST /jobs/plan`: a PLAN card for the sentence (or the suggested kind). Nothing starts. */
export async function planJob(token: string, tenantId: string, input: PlanInput, language: string): Promise<JobPlan> {
  const body = checkPlanInput(input);
  if (jobsScreens() === "mock") return mockPlan(body);
  return parsePlan(await apiRequest(`${base(tenantId)}/jobs/plan`, token, { method: "POST", body: JSON.stringify({ ...body, language }) }));
}
/** `POST /jobs/plan/{id}/start`: the only call that begins anything. */
export async function startPlan(token: string, tenantId: string, planId: string): Promise<JobStarted> {
  if (jobsScreens() === "mock") return mockStartPlan(word(planId, "plan id", 80));
  return parseStarted(await apiRequest(planPath(tenantId, planId, "start"), token, { method: "POST", body: "{}" }));
}
/** `POST /jobs {kind}`: one-tap start of a suggested job. */
export async function startSuggestion(token: string, tenantId: string, kind: JobKind): Promise<JobStarted> {
  oneOf(kind, JOB_KINDS, "kind");
  if (jobsScreens() === "mock") return mockStartedFor(kind);
  return parseStarted(await apiRequest(`${base(tenantId)}/jobs`, token, { method: "POST", body: JSON.stringify({ kind }) }));
}
/** `POST /jobs/plan/{id}/test-call` or `/test-message`: to the owner's OWN phone only. With JOBS=mock nothing is called. */
export async function testPlan(token: string, tenantId: string, planId: string, channel: PlanChannel): Promise<JobTested> {
  oneOf(channel, CHANNELS, "channel");
  if (jobsScreens() === "mock") return { ...mockTest(word(planId, "plan id", 80)), channel };
  await apiRequest(planPath(tenantId, planId, channel === "call" ? "test-call" : "test-message"), token, { method: "POST", body: "{}" });
  return { channel, mock: false };
}
/** `GET /jobs/suggestions`: 3-4 jobs for the business type. With JOBS=mock the saree shop's four or the plain three, chosen by the business type's modules (read by the mock only); null when the API has none yet. */
export async function listSuggestions(token: string, tenantId: string, modules: readonly string[] | null): Promise<SuggestionList | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return mockSuggestions(modules);
  try {
    const json = await apiRequest(`${base(tenantId)}/jobs/suggestions`, token);
    const heading = !Array.isArray(json) && rec(json, "suggestions").heading ? word(rec(json, "suggestions").heading, "heading", 20) : null;
    return { items: parseSuggestions(json), heading };
  } catch {
    return null;
  }
}
