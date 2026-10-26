import { ApiContractError, ApiRequestError, apiBinaryRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { MAX_SAMPLE_BYTES, type SampleQuery } from "@/lib/voice-samples/types";

/**
 * One voice sample from C1's API (job DQ part 3), for our own route to hand to the browser: `GET /v1/tenants/{id}/ai-assistant/voice-sample?voice&language&style&name` (Owner, Admin) answers the sound itself (audio/mpeg, audio/wav or
 * audio/ogg). Until the contract exists (c2-questions-3.md) this is the shape C2 asked for; the route answers 404 when the API has none. SERVER ONLY, the person's own token.
 */
export async function getVoiceSample(token: string, tenantId: string, q: SampleQuery): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const params = new URLSearchParams({ voice: q.voice, language: q.lang, style: q.tone === "crisp" ? "quick" : "warm", ...(q.name ? { name: q.name } : {}) });
  try {
    const got = await apiBinaryRequest(`/v1/tenants/${tenantId}/ai-assistant/voice-sample?${params.toString()}`, token, MAX_SAMPLE_BYTES);
    return /^audio\/(mpeg|wav|x-wav|ogg|mp4|webm)(;|$)/.test(got.contentType) ? got : null;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
