import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseFaq, parseJob, parseJobDetail, parseJobs, parseJobsToday, parsePlan, parseSays, parseSuggestionHeading, parseSuggestions, parseTested, parseWho } from "./jobs-parse";
import { bad, oneOf, rec, uuid, word } from "./shape";
import { FAQ_A_MAX, FAQ_Q_MAX, type JobDetail, type JobFaq, type JobSays, type TestChannel } from "@/lib/jobs/detail";
import { mockJobDetail, mockSays } from "@/lib/jobs/detail-mock";
import { JOB_KINDS, type Job, type JobKind, type JobStatus, type JobSwitched, type TodayJobs } from "@/lib/jobs/types";
import { MOCK_JOBS, mockToday } from "@/lib/jobs/mock";
import type { JobPlan, JobStarted, JobTested, PlanChannel, PlanInput, SuggestionList } from "@/lib/jobs/plan";
import { APPROVAL_KINDS, PLAN_TEXT_MAX, PLAN_TEXT_MIN } from "@/lib/jobs/plan";
import { mockPlan, mockStartPlan, mockStartedFor, mockSuggestions, mockTest } from "@/lib/jobs/plan-mock";
import { jobsScreens } from "@/lib/screens/flag";
import type { SpeaksPatch } from "@/lib/jobs/who";

/**
 * The jobs of a workspace (JOBS; C1's contract, FINAL 1.0: contracts/jobs-contract-DRAFT.md). SERVER ONLY, with the signed-in person's own token. This file makes the calls; every PARSER of the contract is in lib/api/jobs-parse.ts (re-exported here), so a contract
 * change is an edit there. Every answer goes through lib/api/shape.ts: closed words (kind, status), bounded numbers and strings; anything else is an ApiContractError, never drawn. With JOBS=mock the made-up jobs of lib/jobs/fixtures.ts answer and nothing leaves the server.
 */
export { parseFaq, parseJob, parseJobDetail, parseJobs, parseJobsToday, parsePlan, parseSuggestions, parseTested, parseWho };

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};

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

/**
 * `GET /jobs/today`: Today's first paint in one call: the full Job objects (plan_gate and fix included), what waits for the owner and the main assistant's name. The API sets an ETag and answers 304 to `If-None-Match` for the 30 s poll;
 * the server's client (lib/api/client.ts) neither keeps a validator between renders nor reads a 304, so this is a plain GET (a page render asks once). With JOBS=mock the mock jobs answer in the same shape. null when off or the API has none yet.
 */
export async function readJobsToday(token: string, tenantId: string): Promise<TodayJobs | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return mockToday();
  try {
    return parseJobsToday(await apiRequest(`${base(tenantId)}/jobs/today`, token));
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

/* ---- Start a job by saying it, and the suggested jobs (contract sections 3, 4 and 5): the paths of the calls are here, the shapes in lib/api/jobs-parse.ts ---- */
const CHANNELS = ["call", "whatsapp"] as const;
const planPath = (tenantId: string, planId: string, tail: string): string => `${base(tenantId)}/jobs/plan/${encodeURIComponent(word(planId, "plan id", 80))}/${tail}`;

/** `{job_id}` of a start. */
const parseStarted = (json: unknown): JobStarted => {
  const x = rec(json, "started");
  return { jobId: uuid(x.job_id ?? x.id, "job_id") };
};
/**
 * A start (`POST /jobs`, `POST /jobs/plan/{id}/start`): `200 {job_id}` is the job; `409 approval_needed` with `approval {id, kind}` is NOT a failure: the Owner's OK is asked first and the person is told it is waiting. Any other refusal throws as it is.
 */
async function startCall(path: string, token: string, body: unknown): Promise<JobStarted> {
  try {
    return parseStarted(await apiRequest(path, token, { method: "POST", body: JSON.stringify(body) }));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === "approval_needed" && error.extra?.approval) return { approval: { id: error.extra.approval.id, kind: oneOf(error.extra.approval.kind, APPROVAL_KINDS, "approval.kind") } };
    throw error;
  }
}

/** What may be asked of the planner: the owner's sentence (3 to 500 characters), a suggested job's kind, or `as: "whatsapp"` with the id of the plan shown (the WhatsApp version of the same plan). */
export function checkPlanInput(input: PlanInput): PlanInput {
  if ("kind" in input) return { kind: oneOf(input.kind, JOB_KINDS, "kind") };
  if ("as" in input) return { as: oneOf(input.as, ["whatsapp"] as const, "as"), planId: word(input.planId, "plan id", 80) };
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < PLAN_TEXT_MIN || text.length > PLAN_TEXT_MAX) bad("text");
  return { text };
}

/** `POST /jobs/plan` `{text, language}` | `{kind, language}` | `{as: "whatsapp", plan_id}`: a PLAN card for the sentence (or the suggested kind). Nothing starts. */
export async function planJob(token: string, tenantId: string, input: PlanInput, language: string): Promise<JobPlan> {
  const body = checkPlanInput(input);
  if (jobsScreens() === "mock") return mockPlan(body);
  const wire = "as" in body ? { as: body.as, plan_id: body.planId } : body;
  return parsePlan(await apiRequest(`${base(tenantId)}/jobs/plan`, token, { method: "POST", body: JSON.stringify({ ...wire, language }) }));
}
/** `POST /jobs/plan/{id}/start`: the only call that begins anything. A `409 approval_needed` answers `{approval}` (waiting for the Owner's OK), not an error. */
export async function startPlan(token: string, tenantId: string, planId: string): Promise<JobStarted> {
  if (jobsScreens() === "mock") return mockStartPlan(word(planId, "plan id", 80));
  return startCall(planPath(tenantId, planId, "start"), token, {});
}
/** `POST /jobs {kind}`: one-tap start of a suggested job (the same `409 approval_needed` rule). */
export async function startSuggestion(token: string, tenantId: string, kind: JobKind): Promise<JobStarted> {
  oneOf(kind, JOB_KINDS, "kind");
  if (jobsScreens() === "mock") return mockStartedFor(kind);
  return startCall(`${base(tenantId)}/jobs`, token, { kind });
}
/** `POST /jobs/plan/{id}/test-call` or `/test-message`: to the owner's OWN phone only; `{placed: true, minutes_used}`. A `409 quiet_hours` (outside 9 am to 9 pm) is a refusal the screen disables the button for. With JOBS=mock nothing is called. */
export async function testPlan(token: string, tenantId: string, planId: string, channel: PlanChannel): Promise<JobTested> {
  oneOf(channel, CHANNELS, "channel");
  if (jobsScreens() === "mock") return { ...mockTest(word(planId, "plan id", 80)), channel };
  const answer = parseTested(await apiRequest(planPath(tenantId, planId, channel === "call" ? "test-call" : "test-message"), token, { method: "POST", body: "{}" }));
  return { channel, mock: false, minutesUsed: answer.minutesUsed };
}
/** `GET /jobs/suggestions`: 3-4 jobs for the business type. With JOBS=mock the saree shop's four or the plain three, chosen by the business type's modules (read by the mock only); null when the API has none yet. */
export async function listSuggestions(token: string, tenantId: string, modules: readonly string[] | null): Promise<SuggestionList | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return mockSuggestions(modules);
  try {
    const json = await apiRequest(`${base(tenantId)}/jobs/suggestions`, token);
    return { items: parseSuggestions(json), heading: parseSuggestionHeading(json) };
  } catch {
    return null;
  }
}

/* ---- ONE job's page (contract sections 1, 3 and 7) ---- */
const jobId = (id: string): string => (isCanonicalUuid(id) ? id : bad("job id"));

/** `GET /jobs/{id}`; null when the screens are off, or the API does not know the job (the page is then a 404). Any word the web has no sentence for is an ApiContractError (never drawn as a raw code). */
export async function getJob(token: string, tenantId: string, id: string): Promise<JobDetail | null> {
  const mode = jobsScreens();
  if (mode === "off" || !isCanonicalUuid(id)) return null;
  if (mode === "mock") return mockJobDetail(id);
  try {
    return parseJobDetail(await apiRequest(`${base(tenantId)}/jobs/${id}`, token));
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    return null;
  }
}

/** What changed in one `PATCH /jobs/{id}`: the name (null = the plain name), the switch, the words customers hear (recomposed by the API when the name changed, else null). */
export type JobPatch = { name?: string | null; enabled?: boolean; settings?: Readonly<Record<string, string | boolean>>; findsOut?: Readonly<Record<string, boolean>>; /** The Who talks card: only what changed (lib/jobs/who.ts). */ speaks?: SpeaksPatch };
export type JobPatched = { customName: string | null; enabled: boolean; status: JobStatus; says: JobSays[] | null };

/** `PATCH /jobs/{id}` `{enabled?, name?, settings?: {key: value}, finds_out?, speaks?: {language?, tone?, voice?, number?}}` (a choice is sent as its word, a toggle as true/false; an empty name clears it; the hours are the settings `from_hour` and `to_hour`). With JOBS=mock the answer is made up from the mock job and the change; nothing is stored. */
export async function patchJob(token: string, tenantId: string, id: string, patch: JobPatch): Promise<JobPatched> {
  jobId(id);
  if (jobsScreens() === "mock") {
    const j = MOCK_JOBS.find((m) => m.id === id);
    if (!j) bad("job id");
    const customName = patch.name !== undefined ? patch.name : j.customName;
    const enabled = patch.enabled ?? j.enabled;
    return { customName, enabled, status: enabled ? (j.status === "paused" ? "running" : j.status) : "paused", says: patch.name !== undefined ? mockSays(j.kind, customName) : null };
  }
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.name !== undefined) body.name = patch.name ?? "";
  if (patch.settings) body.settings = patch.settings;
  if (patch.findsOut) body.finds_out = patch.findsOut;
  if (patch.speaks) body.speaks = patch.speaks;
  const raw = await apiRequest(`${base(tenantId)}/jobs/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
  const x = rec(raw, "job");
  const j = parseJob(x);
  return { customName: j.customName, enabled: j.enabled, status: j.status, says: x.says === undefined ? null : parseSays(x.says) };
}

/** `POST /jobs/{id}/faqs` (question and answer at most 300 characters each; `422 faq_not_allowed` when an answer promises a price or a discount). With JOBS=mock the new question gets a made-up id and nothing is stored. */
export async function addJobFaq(token: string, tenantId: string, id: string, question: string, answer: string): Promise<JobFaq> {
  jobId(id);
  if (question.length > FAQ_Q_MAX || answer.length > FAQ_A_MAX) bad("faq");
  if (jobsScreens() === "mock") return { id: `faq-new-${Date.now().toString(36)}`, question, answer };
  return parseFaq(await apiRequest(`${base(tenantId)}/jobs/${id}/faqs`, token, { method: "POST", body: JSON.stringify({ question, answer }) }));
}
/** `POST /jobs/{id}/faqs/{faqId}/remove` (the API has no HTTP DELETE). */
export async function removeJobFaq(token: string, tenantId: string, id: string, faqId: string): Promise<void> {
  jobId(id);
  if (jobsScreens() === "mock") return;
  await apiRequest(`${base(tenantId)}/jobs/${id}/faqs/${encodeURIComponent(word(faqId, "faq id", 80))}/remove`, token, { method: "POST", body: "{}" });
}

/**
 * "Test call/message to my phone" (the owner's own phone only): `POST /jobs/{id}/test-call` or `/test-message` -> `{placed: true, minutes_used}`. A test CALL is a real call to the owner's own phone and counts against the free minutes (the answer says how many);
 * outside 9 am to 9 pm the API refuses with `409 quiet_hours`. With JOBS=mock nothing is called or sent: `sent` is false and the page says so in plain words.
 */
export type JobDetailTested = { channel: TestChannel; sent: boolean; minutesUsed: number };
export async function testJob(token: string, tenantId: string, id: string, channel: TestChannel): Promise<JobDetailTested> {
  jobId(id);
  oneOf(channel, ["call", "whatsapp"] as const, "channel");
  if (jobsScreens() === "mock") return { channel, sent: false, minutesUsed: 0 };
  const answer = parseTested(await apiRequest(`${base(tenantId)}/jobs/${id}/${channel === "call" ? "test-call" : "test-message"}`, token, { method: "POST", body: "{}" }));
  return { channel, sent: true, minutesUsed: answer.minutesUsed };
}
