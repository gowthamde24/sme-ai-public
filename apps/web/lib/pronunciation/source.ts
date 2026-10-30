import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { deletePronunciation, getPronunciation, putPronunciation } from "@/lib/api/pronunciation";
import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { readJar, writeJar } from "@/lib/mock/jar";
import { pronunciationScreens } from "@/lib/screens/flag";

import { cleanText, LIST_MAX, parseEntry, SOUND_MAX, WORD_MAX, type Entry, type PronError, type PronList } from "./types";

/**
 * Where the pronunciation list is read and changed. `mock` = ONE small cookie with the entries (nothing is sent), `on` = C1's API, `off` = the part is not there. Every refusal is a closed word the screen has a sentence for. SERVER ONLY; the role
 * (Owner or Admin to change, any member to read) is checked by the caller.
 */
export type Ctx = { token: string; tenantId: string };
export type Read = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: PronList };
export type Saved = { ok: true; entry: Entry } | { ok: false; error: PronError };
export type Removed = { ok: true } | { ok: false; error: PronError };
export const MOCK_COOKIE = "sme_pron_mock";

const parseJar = (v: unknown): Entry[] | null => (Array.isArray(v) ? (v.every((e) => parseEntry({ id: e?.id, word: e?.word, sounds_like: e?.soundsLike, language: e?.language ?? null }) !== null) ? (v as Entry[]) : null) : null);
const same = (a: Entry, word: string, language: CallLang | null) => a.word.toLowerCase() === word.toLowerCase() && a.language === language;

export async function readPronunciation(ctx: Ctx): Promise<Read> {
  const mode = pronunciationScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", data: { items: await readJar(MOCK_COOKIE, parseJar, []), suggestions: [] } };
  try {
    return { mode: "ok", data: await getPronunciation(ctx.token, ctx.tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function savePronunciation(ctx: Ctx, word: unknown, soundsLike: unknown, language: unknown): Promise<Saved> {
  const w = cleanText(word, WORD_MAX);
  const s = cleanText(soundsLike, SOUND_MAX);
  const l = language === null || language === undefined ? null : (CALL_LANGS as readonly unknown[]).includes(language) ? (language as CallLang) : undefined;
  if (w === null || s === null || l === undefined) return { ok: false, error: "invalid" };
  const mode = pronunciationScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const list = await readJar(MOCK_COOKIE, parseJar, []);
    const old = list.find((e) => same(e, w, l));
    if (!old && list.length >= LIST_MAX) return { ok: false, error: "full" };
    const entry: Entry = { id: old?.id ?? crypto.randomUUID(), word: w, soundsLike: s, language: l };
    const next = old ? list.map((e) => (e === old ? entry : e)) : [...list, entry];
    return (await writeJar(MOCK_COOKIE, next)) ? { ok: true, entry } : { ok: false, error: "full" };
  }
  try {
    return { ok: true, entry: await putPronunciation(ctx.token, ctx.tenantId, w, s, l) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422 || error.status === 400) return { ok: false, error: error.code === "pronunciation_limit" ? "full" : "invalid" };
      if (error.status === 404 || error.status === 503) return { ok: false, error: "not_available" };
    }
    return { ok: false, error: "down" };
  }
}

export async function removePronunciation(ctx: Ctx, id: unknown): Promise<Removed> {
  if (typeof id !== "string" || !/^[0-9a-f-]{8,40}$/i.test(id)) return { ok: false, error: "invalid" };
  const mode = pronunciationScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const list = await readJar(MOCK_COOKIE, parseJar, []);
    return (await writeJar(MOCK_COOKIE, list.filter((e) => e.id !== id))) ? { ok: true } : { ok: false, error: "down" };
  }
  try {
    await deletePronunciation(ctx.token, ctx.tenantId, id);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404) return { ok: true }; // already gone
    }
    return { ok: false, error: "down" };
  }
}
