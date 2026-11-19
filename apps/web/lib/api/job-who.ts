import { jobsScreens } from "@/lib/screens/flag";
import type { JobDetail } from "@/lib/jobs/detail";
import { WIRE_WHO_VOICES } from "@/lib/jobs/fixtures";
import { WHO_VOICES, type WhoTarget, type WhoVoice, type WhoVoiceName } from "@/lib/jobs/who";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { getJob, readJobs } from "./jobs";

export type { WhoTarget, WhoVoiceName };

/**
 * The three voices a job may use, by name: `GET /v1/tenants/{t}/ai-assistant/voices` (C1 contract 1.1 part 1, section 8 answer 5: the catalogue Voice & tone uses, ids `female_warm`, `female_clear`, `male_calm`, each with its `name` and `sample`).
 * Lenient on purpose (the name of a voice is a nicety, never a reason to hide the card): rows are read from `{voices: [...]}`, a bare list, or the per-language rows of the picker (`{languages: [{voices: [...]}]}`); only the three known ids with a short plain name are kept;
 * anything else gives null and the card uses the names of our own words (`jobs.who.voice.<id>`). With JOBS=mock the demo's three.
 */
export function parseWhoVoices(json: unknown): WhoVoiceName[] | null {
  const rows: unknown[] = [];
  const take = (v: unknown) => {
    if (Array.isArray(v)) rows.push(...v.slice(0, 60));
  };
  if (Array.isArray(json)) take(json);
  else if (json && typeof json === "object") {
    const x = json as Record<string, unknown>;
    take(x.voices);
    if (Array.isArray(x.languages)) for (const l of x.languages.slice(0, 12)) if (l && typeof l === "object") take((l as Record<string, unknown>).voices);
  }
  const out: WhoVoiceName[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const { id, name } = r as Record<string, unknown>;
    if (typeof id !== "string" || !(WHO_VOICES as readonly string[]).includes(id) || out.some((o) => o.id === id)) continue;
    if (typeof name !== "string" || !/^[\p{L}\p{M}\p{N} .'’-]{1,40}$/u.test(name)) continue;
    out.push({ id: id as WhoVoice, name });
  }
  return out.length > 0 ? out : null;
}

export async function readWhoVoices(token: string, tenantId: string): Promise<WhoVoiceName[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseWhoVoices(WIRE_WHO_VOICES);
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  try {
    return parseWhoVoices(await apiRequest(`/v1/tenants/${tenantId}/ai-assistant/voices`, token));
  } catch {
    return null;
  }
}

/**
 * The one other job the Who talks card offers to change by talking: "Make the visits job speak Telugu" (mock sheet r3-06, the assistant's `jobs.change`). It is the visits job (`store_visits`) when this page is another job and the visits job does not speak Telugu yet.
 * Read from the jobs list and that job's own page (its `speaks`); any failure means no suggestion (never an error on the page). Off = nothing.
 */
export async function readWhoTarget(token: string, tenantId: string, current: JobDetail): Promise<WhoTarget | null> {
  if (jobsScreens() === "off" || !current.who || current.job.kind === "store_visits") return null;
  try {
    const sibling = (await readJobs(token, tenantId))?.find((j) => j.kind === "store_visits" && j.id !== current.job.id);
    if (!sibling) return null;
    const detail = await getJob(token, tenantId, sibling.id);
    if (!detail?.who || detail.who.language === "te") return null;
    return { id: sibling.id, kind: sibling.kind, customName: sibling.customName, language: detail.who.language, to: "te" };
  } catch {
    return null;
  }
}
