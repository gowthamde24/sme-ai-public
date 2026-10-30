import { ApiContractError, ApiRequestError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { cleanText, parseEntry, parseList, SOUND_MAX, WORD_MAX, type Entry, type PronList } from "@/lib/pronunciation/types";
import type { CallLang } from "@/lib/assistant/types";

/**
 * The workspace's pronunciation list, as C1's API has it (contract-pronunciation.md, 30 Oct): under `/v1/tenants/{id}/ai-assistant`:
 *   GET  /pronunciation          any member -> { items: [{id, word, sounds_like, language|null}], suggestions: [{word, reason}] }
 *   PUT  /pronunciation          Owner, Admin { word, sounds_like, language|null, message_id? }  (one entry per word and language: saving again changes it) -> the entry
 *   POST /pronunciation/{id}/delete   Owner, Admin -> 204 (the API has no DELETE verb)
 *   POST /pronunciation/preview  Owner, Admin { word, sounds_like, language } -> audio/wav: the word in a short sentence in the workspace's voice, with this respelling (nothing saved); 404 no_sample, 429 rate_limited
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

/** The sound of a word with this respelling, said in a short sentence in the workspace's voice for that language (`POST /pronunciation/preview`, nothing is saved); null = no voice service (404). A 429 is passed on to the caller. */
export async function speakWord(token: string, tenantId: string, word: string, soundsLike: string, language: CallLang): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const w = cleanText(word, WORD_MAX);
  const s = cleanText(soundsLike, SOUND_MAX);
  if (w === null || s === null) throw new ApiContractError("invalid");
  try {
    const got = await apiBinaryRequest(`${base(tenantId)}/pronunciation/preview`, token, 4_000_000, { body: { word: w, sounds_like: s, language } });
    const type = got.contentType.split(";")[0].trim();
    return /^audio\/(wav|x-wav|mpeg|ogg|mp4|webm)$/.test(type) ? { bytes: got.bytes, contentType: type === "audio/x-wav" ? "audio/wav" : type } : null;
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.code === "no_sample")) return null;
    throw error;
  }
}
