import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getVoicePicker, putVoiceChoice } from "@/lib/api/voice-picker";
import { readJar, writeJar } from "@/lib/mock/jar";
import { voicePickerScreens } from "@/lib/screens/flag";

import { MOCK_VOICES, PICKER_LANGS, VOICE_ID, type Choices, type Picker, type PickerLang } from "./types";

/**
 * Where the voice picker gets the catalogue and saves the choice. `mock` = the approved catalogue of 28 Oct and ONE small cookie for the choice, no real voices (the sounds are tones); `on` = C1's API (lib/api/voice-picker.ts, C1's contract);
 * `off` = the part is not there. Every move checks its input again here (the browser is not trusted): a language of the four, a voice id of the catalogue. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string };
export const MOCK_COOKIE = "sme_voicepick_mock";
export type SaveError = "invalid" | "forbidden" | "read_only" | "not_available" | "down";
export type Saved<T> = { ok: true; data: T } | { ok: false; error: SaveError };

const parseChoices = (v: unknown): Choices | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Choices = {};
  for (const l of PICKER_LANGS) {
    const c = (v as Record<string, unknown>)[l];
    if (typeof c === "string" && MOCK_VOICES.some((x) => x.id === c && x.language === l)) out[l] = c;
  }
  return out;
};
const mock = async (): Promise<Picker> => ({ voices: [...MOCK_VOICES], choices: await readJar(MOCK_COOKIE, parseChoices, {}), fake: true });

const refusal = (error: unknown): SaveError => {
  if (error instanceof ApiRequestError) {
    if (error.code === "workspace_read_only") return "read_only";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return "invalid";
  }
  return "down";
};

export async function readVoicePicker(ctx: Ctx): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: Picker }> {
  const mode = voicePickerScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", data: await mock() };
  try {
    return { mode: "ok", data: await getVoicePicker(ctx.token, ctx.tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

/** `voiceId` null = back to the default. */
export async function saveVoiceChoice(ctx: Ctx, language: unknown, voiceId: unknown): Promise<Saved<Picker>> {
  const mode = voicePickerScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (typeof language !== "string" || !(PICKER_LANGS as readonly string[]).includes(language)) return { ok: false, error: "invalid" };
  if (voiceId !== null && (typeof voiceId !== "string" || !VOICE_ID.test(voiceId))) return { ok: false, error: "invalid" };
  const lang = language as PickerLang;
  if (mode === "mock") {
    if (voiceId !== null && !MOCK_VOICES.some((x) => x.id === voiceId && x.language === lang)) return { ok: false, error: "invalid" };
    const next: Choices = { ...(await readJar(MOCK_COOKIE, parseChoices, {})) };
    if (voiceId === null) delete next[lang];
    else next[lang] = voiceId;
    if (!(await writeJar(MOCK_COOKIE, next))) return { ok: false, error: "invalid" };
    return { ok: true, data: await mock() };
  }
  try {
    return { ok: true, data: await putVoiceChoice(ctx.token, ctx.tenantId, lang, voiceId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}
