import { ApiContractError, apiFormRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Typing by voice (C1's docs/contracts/speech-transcribe.md, 9 Nov 2026): `POST /v1/tenants/{t}/speech/transcribe`, multipart `audio` and `language` (te, kn, hi, en or auto), with the person's own token. The answer is `{text, language}`: the text is
 * ready to put in the field (the brand and Indian grouping are written by the API). The recording is passed on and never kept; the words are never logged here. Errors: too_long, empty, cap_reached (with retry_after), unsupported, unavailable, timeout.
 */
export const SPEECH_LANGUAGES = ["te", "kn", "hi", "en", "auto"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
export type Transcript = { text: string; language: string | null };

export async function transcribeSpeech(token: string, tenantId: string, audio: Blob, language: SpeechLanguage): Promise<Transcript> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const form = new FormData();
  form.set("audio", audio, "speech");
  form.set("language", language);
  const json = await apiFormRequest(`/v1/tenants/${tenantId}/speech/transcribe`, token, form);
  if (typeof json !== "object" || json === null || typeof (json as { text?: unknown }).text !== "string") throw new ApiContractError("Unexpected transcript.");
  const j = json as { text: string; language?: unknown };
  return { text: j.text.slice(0, 4000), language: typeof j.language === "string" && /^[a-z]{2,3}$/.test(j.language) ? j.language : null };
}
