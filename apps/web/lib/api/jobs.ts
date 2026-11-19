import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, oneOf, optIso, rec, str, uuid, word } from "./shape";
import { RESULT_STATUSES, type JobDetail, type JobFaq, type JobSays, type JobSetting, type TestChannel } from "@/lib/jobs/detail";
import { composeSays, mockJobDetail, MOCK_BUSINESS } from "@/lib/jobs/detail-mock";
import { JOB_KINDS, JOB_STATUSES, type Job, type JobParams, type JobStatus, type JobSwitched } from "@/lib/jobs/types";
import { MOCK_JOBS } from "@/lib/jobs/mock";
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

/* ---- ONE job's page (contracts/jobs-web-needs.md sections 2, 3 and 7): the detail parser is the ADAPTER, the one place that changes when C1 publishes the contract ---- */
const jobId = (id: string): string => (isCanonicalUuid(id) ? id : bad("job id"));
const params12 = (v: unknown): JobParams => params(v);

function parseSays(v: unknown): JobSays[] {
  return list(v ?? [], "says", 12).map((row) => {
    const x = rec(row, "says");
    return { language: word(x.language, "says.language", 12), channel: oneOf(x.channel, ["call", "whatsapp"] as const, "says.channel"), text: str(x.text, "says.text", 1000) };
  });
}
function parseSetting(row: unknown): JobSetting {
  const x = rec(row, "setting");
  const options = list(x.options, "setting.options", 40).map((o) => word(o, "option", 40));
  const value = word(x.value, "setting.value", 40);
  if (!options.includes(value)) bad("setting.value");
  return { key: word(x.key, "setting.key"), type: oneOf(x.type ?? "choice", ["choice", "toggle"] as const, "setting.type"), value, options, more: x.area === "more" || x.more === true };
}

/** `GET /jobs/{id}`: everything of the page in one call. Any word the web has no sentence for is an ApiContractError (never drawn as a raw code). */
export function parseJobDetail(json: unknown): JobDetail {
  const x = rec(json, "job");
  const what = rec(x.what_it_does ?? { code: "custom" }, "what_it_does");
  const effect = x.effect === null || x.effect === undefined ? null : rec(x.effect, "effect");
  const results = rec(x.results ?? {}, "results");
  const failure = x.failure === null || x.failure === undefined ? null : rec(x.failure, "failure");
  const item = (row: unknown) => {
    const r = rec(row, "item");
    return { customer: str(r.customer, "item.customer", 80), detailCode: word(r.detail_code, "item.detail_code"), params: params12(r.params), at: optIso(r.at, "item.at") ?? "" };
  };
  return {
    job: parseJob(x),
    business: str(x.business_name, "business_name", 80),
    whatCode: word(what.code, "what_it_does.code"),
    says: parseSays(x.says),
    settings: list(x.settings ?? [], "settings", 30).map(parseSetting),
    effectInputs: effect ? params12(effect.inputs) : null,
    findsOut: list(x.finds_out ?? [], "finds_out", 30).map((row) => {
      const r = rec(row, "finds_out");
      return { key: word(r.key, "finds_out.key"), enabled: bool(r.enabled, "finds_out.enabled") };
    }),
    faqs: list(x.faqs ?? [], "faqs", 100).map(parseFaq),
    results: {
      days: int(results.days ?? 7, "results.days", 1, 365),
      numbers: Object.entries(rec(results.numbers ?? {}, "results.numbers")).slice(0, 6).map(([key, value]) => ({ key: word(key, "number"), value: int(value, "number", 0, 100_000_000) })),
      items: list(results.items ?? [], "results.items", 50).map((row) => ({ ...item(row), status: oneOf(rec(row, "item").status, RESULT_STATUSES, "item.status") })),
    },
    failure: failure ? { code: word(failure.code, "failure.code"), params: params12(failure.params), items: list(failure.items ?? [], "failure.items", 50).map(item) } : null,
    test: x.test_channel === null || x.test_channel === undefined ? null : oneOf(x.test_channel, ["call", "message"] as const, "test_channel"),
  };
}
export function parseFaq(row: unknown): JobFaq {
  const r = rec(row, "faq");
  return { id: word(r.id, "faq.id", 80), question: str(r.question, "faq.question", 200), answer: str(r.answer, "faq.answer", 500) };
}

/** `GET /jobs/{id}`; null when the screens are off, or the API does not know the job (the page is then a 404). */
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
export type JobPatch = { name?: string | null; enabled?: boolean; settings?: Readonly<Record<string, string>>; findsOut?: Readonly<Record<string, boolean>> };
export type JobPatched = { customName: string | null; enabled: boolean; status: JobStatus; says: JobSays[] | null };

/** `PATCH /jobs/{id}` `{enabled?, name?, settings?, finds_out?}` (an empty name clears it). With JOBS=mock the answer is made up from the mock job and the change; nothing is stored. */
export async function patchJob(token: string, tenantId: string, id: string, patch: JobPatch): Promise<JobPatched> {
  jobId(id);
  if (jobsScreens() === "mock") {
    const j = MOCK_JOBS.find((m) => m.id === id);
    if (!j) bad("job id");
    const customName = patch.name !== undefined ? patch.name : j.customName;
    const enabled = patch.enabled ?? j.enabled;
    return { customName, enabled, status: enabled ? (j.status === "paused" ? "running" : j.status) : "paused", says: patch.name !== undefined ? composeSays(j.kind, customName, MOCK_BUSINESS) : null };
  }
  const body: Record<string, unknown> = {};
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.name !== undefined) body.name = patch.name ?? "";
  if (patch.settings) body.settings = patch.settings;
  if (patch.findsOut) body.finds_out = patch.findsOut;
  const raw = await apiRequest(`${base(tenantId)}/jobs/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });
  const x = rec(raw, "job");
  const j = parseJob(x);
  return { customName: j.customName, enabled: j.enabled, status: j.status, says: x.says === undefined ? null : parseSays(x.says) };
}

/** `POST /jobs/{id}/faqs` (needs doc section 7). With JOBS=mock the new question gets a made-up id and nothing is stored. */
export async function addJobFaq(token: string, tenantId: string, id: string, question: string, answer: string): Promise<JobFaq> {
  jobId(id);
  if (jobsScreens() === "mock") return { id: `faq-new-${Date.now().toString(36)}`, question, answer };
  return parseFaq(await apiRequest(`${base(tenantId)}/jobs/${id}/faqs`, token, { method: "POST", body: JSON.stringify({ question, answer }) }));
}
/** `DELETE /jobs/{id}/faqs/{faqId}`. */
export async function removeJobFaq(token: string, tenantId: string, id: string, faqId: string): Promise<void> {
  jobId(id);
  if (jobsScreens() === "mock") return;
  await apiRequest(`${base(tenantId)}/jobs/${id}/faqs/${encodeURIComponent(word(faqId, "faq id", 80))}`, token, { method: "DELETE" });
}

/** "Test call/message to my phone" (the owner's own phone only; needs doc section 4, here per job). With JOBS=mock nothing is called or sent: `sent` is false and the page says so in plain words. */
export type JobTested = { channel: TestChannel; sent: boolean };
export async function testJob(token: string, tenantId: string, id: string, channel: TestChannel): Promise<JobTested> {
  jobId(id);
  if (jobsScreens() === "mock") return { channel, sent: false };
  await apiRequest(`${base(tenantId)}/jobs/${id}/${channel === "call" ? "test-call" : "test-message"}`, token, { method: "POST", body: "{}" });
  return { channel, sent: true };
}
