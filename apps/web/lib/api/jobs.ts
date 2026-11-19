import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, oneOf, optIso, rec, str, uuid, word } from "./shape";
import { JOB_KINDS, JOB_STATUSES, type Job, type JobParams, type JobSwitched } from "@/lib/jobs/types";
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
