import { jobsScreens } from "@/lib/screens/flag";
import type { JobDetail } from "@/lib/jobs/detail";
import { type WhoTarget, type WhoVoiceName } from "@/lib/jobs/who";
import { MOCK_VOICES, type Picker } from "@/lib/voice-picker/types";

import { ApiContractError } from "./client";
import { isCanonicalUuid } from "./crm";
import { getJob, readJobs } from "./jobs";
import { getVoicePicker } from "./voice-picker";

export type { WhoTarget, WhoVoiceName };

/**
 * The voices a job may use, THE SAME list as the voice card (owner, 20 Nov 2026; C1 voices-tones.md section 9): `GET /v1/tenants/{t}/ai-assistant/voices`, the voices of the workspace's gender (ids `te-ramya`, `hi-kabir`, ...), each with its first name, its language, whether it is the recommended one and whether it has
 * a recording to play. Lenient on purpose (a list of voices is a nicety, never a reason to hide the card): anything that is not the picker's answer gives null and the card draws no voice list. With JOBS=mock the voice card's own test voices.
 */
export function whoVoicesOf(picker: Picker | null): WhoVoiceName[] | null {
  if (!picker) return null;
  const out = picker.voices.filter((v) => v.gender === picker.gender).map((v): WhoVoiceName => ({ id: v.id, name: v.name, language: v.language, recommended: v.recommended }));
  return out.length > 0 ? out : null;
}

export async function readWhoVoices(token: string, tenantId: string): Promise<WhoVoiceName[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return whoVoicesOf({ gender: "female", voices: [...MOCK_VOICES], choices: {}, active: {}, fake: true });
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  try {
    return whoVoicesOf(await getVoicePicker(token, tenantId));
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
