import { createHash } from "node:crypto";

import type { VoiceAvailability } from "./voice";

/**
 * A "voice is on" answer kept for five minutes per person and workspace, in the memory of this server (the browser never caches it). The probe (`probeVoice`) is a POST of an empty recording that the API refuses with a 422; it was sent on EVERY page
 * load (staging request log, 12 Nov 2026: 6 of 7 loads). An answer of "no" or "not known" is never kept, so a voice switched on is found at the next ask. SERVER ONLY.
 */
const YES_FOR_MS = 5 * 60_000;
const YES_MAX = 500;
const yes = new Map<string, { until: number; answer: VoiceAvailability }>();
const keyOf = (token: string, tenantId: string) => `${tenantId}:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;

/** `probe` is the real ask (`probeVoice`). */
export async function voiceAvailabilityKept(probe: (token: string, tenantId: string) => Promise<VoiceAvailability>, token: string, tenantId: string, now: number = Date.now()): Promise<VoiceAvailability> {
  const key = keyOf(token, tenantId);
  const kept = yes.get(key);
  if (kept && kept.until > now) return kept.answer;
  const answer = await probe(token, tenantId);
  if (answer.available) {
    if (yes.size >= YES_MAX) for (const [k, v] of yes) if (v.until <= now || yes.size >= YES_MAX) yes.delete(k);
    yes.set(key, { until: now + YES_FOR_MS, answer });
  } else yes.delete(key);
  return answer;
}

/** For tests. */
export const forgetVoiceYes = (): void => yes.clear();
