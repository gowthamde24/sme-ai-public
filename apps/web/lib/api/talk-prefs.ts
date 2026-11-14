import { ApiContractError, apiRequest } from "./client";
import { cleanPatch, isTalkLang, parseTalkPrefs, type Patch, type TalkLang, type TalkPrefs } from "@/lib/talk-prefs/types";

/**
 * "How it talks to you" from C1's API (docs/contracts/owner-talk-prefs.md). The signed-in person's own token; the user is the token's user, there is no tenant in the path:
 *   GET  /v1/me/talk-prefs?language=            -> the person's choices + `options` (the lists)
 *   PUT  /v1/me/talk-prefs {language?, voice?, style?, address?, words?, speed?}  -> the same + `undo_token` (15 min) + `changed`
 *   POST /v1/me/talk-prefs/undo {undo_token}    -> the same, as it was (404 expired or used; 409 changed since)
 *   POST /v1/me/talk-prefs/preview {language, option} -> {text, content_type, sample_rate, audio_base64} (404 not_available; 429 too many)
 */
const checked = (value: TalkPrefs | null): TalkPrefs => {
  if (value === null) throw new ApiContractError("Unexpected talk-prefs response.");
  return value;
};
const lang = (language: unknown): TalkLang => {
  if (!isTalkLang(language)) throw new ApiContractError("language");
  return language;
};

export const getTalkPrefs = async (token: string, language: unknown): Promise<TalkPrefs> => {
  const l = lang(language);
  return checked(parseTalkPrefs(await apiRequest(`/v1/me/talk-prefs?${new URLSearchParams({ language: l }).toString()}`, token), l));
};

export async function putTalkPrefs(token: string, language: unknown, patch: unknown): Promise<TalkPrefs> {
  const l = lang(language);
  const p = cleanPatch(patch);
  if (p === null) throw new ApiContractError("patch");
  return checked(parseTalkPrefs(await apiRequest("/v1/me/talk-prefs", token, { method: "PUT", body: JSON.stringify({ language: l, ...p }) }), l));
}

export async function undoTalkPrefs(token: string, language: unknown, undoToken: unknown): Promise<TalkPrefs> {
  const l = lang(language);
  if (typeof undoToken !== "string" || !/^[\w-]{8,200}$/.test(undoToken)) throw new ApiContractError("undo token");
  await apiRequest("/v1/me/talk-prefs/undo", token, { method: "POST", body: JSON.stringify({ undo_token: undoToken }) });
  return getTalkPrefs(token, l); // the answer of undo is the body again; read for THIS language (the voice is per language)
}

/** The Undo of a card the assistant made when it changed a choice by talking: the token the card carried. The answer is not needed. */
export async function postUndoTalkPrefs(token: string, undoToken: unknown): Promise<void> {
  if (typeof undoToken !== "string" || !/^[\w-]{8,200}$/.test(undoToken)) throw new ApiContractError("undo token");
  await apiRequest("/v1/me/talk-prefs/undo", token, { method: "POST", body: JSON.stringify({ undo_token: undoToken }) });
}

export type Preview = { text: string; contentType: string; audioBase64: string };
/** The sample of one option; null when the answer does not read. A 404 / 429 comes up as the request error (the action turns it into words). */
export async function previewTalkPrefs(token: string, language: unknown, option: Patch): Promise<Preview | null> {
  const l = lang(language);
  const p = cleanPatch(option);
  if (p === null) throw new ApiContractError("option");
  const json = (await apiRequest("/v1/me/talk-prefs/preview", token, { method: "POST", body: JSON.stringify({ language: l, option: p }) })) as Record<string, unknown> | null;
  if (!json || typeof json.text !== "string" || typeof json.audio_base64 !== "string" || typeof json.content_type !== "string") return null;
  if (!/^audio\/(wav|x-wav|mpeg|ogg|mp4|webm)(;|$)/.test(json.content_type) || json.audio_base64.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(json.audio_base64)) return null;
  return { text: json.text.slice(0, 400), contentType: json.content_type, audioBase64: json.audio_base64 };
}
