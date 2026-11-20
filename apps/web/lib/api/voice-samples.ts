import { ApiContractError, ApiRequestError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { MAX_SAMPLE_BYTES, type SampleQuery } from "@/lib/voice-samples/types";

/**
 * One voice sample from C1's API (job DQ part 3), for our own route to hand to the browser: `GET /v1/tenants/{id}/ai-assistant/voice-preview?voice&language&style&name` (Owner, Admin) answers the sound itself (audio/mpeg, audio/wav or
 * audio/ogg). Until the contract exists (c2-questions-3.md) this is the shape C2 asked for; the route answers 404 when the API has none. SERVER ONLY, the person's own token.
 */
export async function getVoicePreview(token: string, tenantId: string, q: SampleQuery): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const params = new URLSearchParams({ voice: q.voice, language: q.lang, style: q.tone === "crisp" ? "quick" : "warm", ...(q.name ? { name: q.name } : {}) });
  try {
    const got = await apiBinaryRequest(`/v1/tenants/${tenantId}/ai-assistant/voice-preview?${params.toString()}`, token, MAX_SAMPLE_BYTES);
    return /^audio\/(mpeg|wav|x-wav|ogg|mp4|webm)(;|$)/.test(got.contentType) ? got : null;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

export interface PreviewText {
  text: string;
  assistantName: string;
  businessName: string;
}

/** `GET .../ai-assistant/voice-preview/text?language&style&name`: the same words as the sound, to show beside the player. null when the API has none. */
export async function getVoicePreviewText(token: string, tenantId: string, q: SampleQuery): Promise<PreviewText | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const params = new URLSearchParams({ language: q.lang, style: q.tone === "crisp" ? "quick" : "warm", ...(q.name ? { name: q.name } : {}) });
  try {
    const json = await apiRequest(`/v1/tenants/${tenantId}/ai-assistant/voice-preview/text?${params.toString()}`, token);
    const r = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    if (typeof r.text !== "string" || r.text.length < 1 || r.text.length > 2000 || typeof r.assistant_name !== "string" || typeof r.business_name !== "string") throw new ApiContractError("Unexpected body in a voice preview text response.");
    return { text: r.text, assistantName: r.assistant_name, businessName: r.business_name };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The words of the voice preview in ONE tone and language, for the example under "How it talks" (voices-tones.md section 3): `GET .../voice-preview/text?language=&style=warm|respectful|quick`. Nothing is spoken, nothing is saved, no cost. The tone is the screen's own
 * word (friendly | respectful | quick); the API's `style` word for friendly is `warm`. null = the API has no such text (404): the screen keeps its own example sentence.
 */
export async function getToneExample(token: string, tenantId: string, language: string, tone: "friendly" | "respectful" | "quick"): Promise<string | null> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  if (!/^[a-z]{2}$/.test(language)) throw new ApiContractError("language");
  const params = new URLSearchParams({ language, style: tone === "friendly" ? "warm" : tone });
  try {
    const json = await apiRequest(`/v1/tenants/${tenantId}/ai-assistant/voice-preview/text?${params.toString()}`, token);
    const text = typeof json === "object" && json !== null ? (json as Record<string, unknown>).text : null;
    return typeof text === "string" && text.trim() !== "" && text.length <= 2000 ? text.trim() : null;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
