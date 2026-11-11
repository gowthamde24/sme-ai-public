import { parseRun, parseRuns, parseSweep, parseSweepList, parseSweepPreview, sweepProblem, type Sweep, type SweepChange, type SweepInput, type SweepList, type SweepPreview, type SweepRun } from "@/lib/lead-finder/sweeps";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's weekly sweep routes (PROPOSAL docs/contracts/lead-finder-sweep.md, 11 Nov 2026: written against the proposal, they do not exist in the API yet, so this is only used with SWEEP_SCREENS=1). Owner and Admin change things;
 * Sales and the Owner read. A sweep never dials anyone. Anything the API answers that does not fit the contract is a contract error, never a guess.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}/lead-finder/sweeps`;
};
const id = (v: string): string => {
  if (!isCanonicalUuid(v)) throw new ApiContractError("Unexpected sweep id.");
  return v;
};
const must = <T>(v: T | null, what: string): T => {
  if (v === null) throw new ApiContractError(`Unexpected ${what}.`);
  return v;
};
const PLAN_LANGS = ["en", "te", "hi", "kn", "ta", "ml", "mr"] as const;

export async function listSweeps(token: string, tenantId: string): Promise<SweepList> {
  return must(parseSweepList(await apiRequest(base(tenantId), token)), "sweep list");
}
const bodyOf = (input: SweepInput) => ({ text: input.text.trim(), language: (PLAN_LANGS as readonly string[]).includes(input.language) ? input.language : "en", weekday: input.weekday, hour: input.hour, max_results: input.maxResults });
/** The card before the OK (C1, 11 Nov: `POST /sweeps/preview`, the same body as create; nothing is stored, searched or billed). */
export async function previewSweep(token: string, tenantId: string, input: SweepInput): Promise<SweepPreview> {
  if (sweepProblem(input)) throw new ApiContractError("Unexpected sweep input.");
  return must(parseSweepPreview(await apiRequest(`${base(tenantId)}/preview`, token, { method: "POST", body: JSON.stringify(bodyOf(input)) })), "sweep preview");
}
/** Create (the Owner's or Admin's standing OK for exactly this search, up to its cap and budget). The words are the owner's own, as in the plan card. */
export async function createSweep(token: string, tenantId: string, input: SweepInput): Promise<Sweep> {
  if (sweepProblem(input)) throw new ApiContractError("Unexpected sweep input.");
  return must(parseSweep(await apiRequest(base(tenantId), token, { method: "POST", body: JSON.stringify(bodyOf(input)) })), "sweep");
}
/** `PUT`: any subset of weekday, hour, max_results, enabled (true resumes, false pauses). The words of a search cannot be changed. */
export async function changeSweep(token: string, tenantId: string, sweepId: string, change: SweepChange): Promise<Sweep> {
  const body: Record<string, number | boolean> = {};
  if (change.weekday !== undefined) body.weekday = change.weekday;
  if (change.hour !== undefined) body.hour = change.hour;
  if (change.maxResults !== undefined) body.max_results = change.maxResults;
  if (change.enabled !== undefined) body.enabled = change.enabled;
  if (Object.keys(body).length === 0) throw new ApiContractError("Unexpected sweep change.");
  return must(parseSweep(await apiRequest(`${base(tenantId)}/${id(sweepId)}`, token, { method: "PUT", body: JSON.stringify(body) })), "sweep");
}
/** Run it now (the Owner's click is the OK; it counts as a search today). */
export async function runSweepNow(token: string, tenantId: string, sweepId: string): Promise<SweepRun> {
  return must(parseRun(await apiRequest(`${base(tenantId)}/${id(sweepId)}/run`, token, { method: "POST", body: "{}" })), "sweep run");
}
/** Take it off the list for good (its past prospects stay); a second call answers the same. */
export async function removeSweep(token: string, tenantId: string, sweepId: string): Promise<void> {
  const out = await apiRequest(`${base(tenantId)}/${id(sweepId)}/remove`, token, { method: "POST", body: "{}" });
  if (typeof out !== "object" || out === null || (out as { removed?: unknown }).removed !== true) throw new ApiContractError("Unexpected remove answer.");
}
export async function listSweepRuns(token: string, tenantId: string, sweepId: string, limit = 20): Promise<SweepRun[]> {
  const q = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Math.trunc(limit)))) });
  return must(parseRuns(await apiRequest(`${base(tenantId)}/${id(sweepId)}/runs?${q}`, token)), "sweep runs");
}
