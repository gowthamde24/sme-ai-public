import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { cleanText, parseEntry, parseList, SOUND_MAX, WORD_MAX, type Entry, type PronList } from "@/lib/pronunciation/types";
import type { CallLang } from "@/lib/assistant/types";

/**
 * The workspace's pronunciation list, as C1's API has it (DRAFT contract, job pronunciation-quality; the real one replaces this file's paths): under `/v1/tenants/{id}/ai-assistant`:
 *   GET  /pronunciation          any member -> { items: [{id, word, sounds_like, language|null}], suggestions: [{word, reason}] }
 *   PUT  /pronunciation          Owner, Admin { word, sounds_like, language|null }  (one entry per word and language: saving again changes it) -> the entry
 *   POST /pronunciation/{id}/delete   Owner, Admin -> 204 (the API has no DELETE verb)
 *   POST /voices/preview         { language, text, mention_ai: null, assistant_name: null } -> the sound of `text` in the voice in force (the same as the opening line's "Hear it")
 * SERVER ONLY, with the signed-in person's own token.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-assistant`;
};

export async function getPronunciation(token: string, tenantId: string): Promise<PronList> {
  const out = parseList(await apiRequest(`${base(tenantId)}/pronunciation`, token));
  if (out === null) throw new ApiContractError("Unexpected pronunciation response.");
  return out;
}

export async function putPronunciation(token: string, tenantId: string, word: string, soundsLike: string, language: CallLang | null): Promise<Entry> {
  const w = cleanText(word, WORD_MAX);
  const s = cleanText(soundsLike, SOUND_MAX);
  if (w === null || s === null) throw new ApiContractError("invalid");
  const out = parseEntry(await apiRequest(`${base(tenantId)}/pronunciation`, token, { method: "PUT", body: JSON.stringify({ word: w, sounds_like: s, language }) }));
  if (out === null) throw new ApiContractError("Unexpected pronunciation response.");
  return out;
}

export async function deletePronunciation(token: string, tenantId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/pronunciation/${id}/delete`, token, { method: "POST", body: "{}" });
}

/** The sound of the "sounds like" text in the workspace's voice for that language; null = no voice service. Same envelope as the opening line's preview. */
export async function speakSoundsLike(token: string, tenantId: string, language: CallLang, soundsLike: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const text = cleanText(soundsLike, SOUND_MAX);
  if (text === null) throw new ApiContractError("invalid");
  let json: unknown;
  try {
    json = await apiRequest(`${base(tenantId)}/voices/preview`, token, { method: "POST", body: JSON.stringify({ language, text, mention_ai: null, assistant_name: null }) });
  } catch (error) {
    if (error instanceof ApiRequestError && (error.code === "no_preview" || error.status === 404)) return null;
    throw error;
  }
  const audio = typeof json === "object" && json !== null && typeof (json as { audio?: unknown }).audio === "object" ? ((json as { audio: { base64?: unknown; mime?: unknown } }).audio ?? null) : null;
  const mime = audio?.mime === "audio/x-wav" ? "audio/wav" : audio?.mime;
  if (!audio || typeof audio.base64 !== "string" || audio.base64.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(audio.base64) || typeof mime !== "string" || !/^audio\/(wav|mpeg|ogg|mp4|webm)$/.test(mime)) return null;
  return { bytes: Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0)), contentType: mime };
}
