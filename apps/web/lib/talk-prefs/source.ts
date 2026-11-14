import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getTalkPrefs, previewTalkPrefs, putTalkPrefs, undoTalkPrefs } from "@/lib/api/talk-prefs";
import { readJar, writeJar } from "@/lib/mock/jar";
import { ownerTalkPrefs } from "@/lib/screens/flag";

import { MOCK_START, mockOptions, mockPrefs, mockSample, type MockChoices } from "./mock";
import { ADDRESSES, cleanPatch, isTalkLang, SPEEDS, STYLES, VOICE_ID, WORDS, type Field, type Patch, type TalkLang, type TalkPrefs } from "./types";

/**
 * Where "How it talks to you" gets and saves the person's choices: `mock` = ONE cookie of this browser (no sound), `1` = C1's `/v1/me/talk-prefs`, off = the part is not there. Every move checks its input again here
 * (the browser is not trusted): a language of the four, one change at a time, an id of the lists. The choices belong to the signed-in USER, never to the business. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_talkprefs_mock";
export type Fail = "invalid" | "not_available" | "limit" | "expired" | "changed" | "down";
export type Out<T> = { ok: true; data: T } | { ok: false; error: Fail };
export type Sample = { text: string; audio: { contentType: string; base64: string } | null };

type Jar = { cur: MockChoices; prev: MockChoices | null; token: string | null; changed: Field[] };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const choices = (v: unknown): MockChoices | null => {
  if (!isRec(v)) return null;
  const style = STYLES.find((x) => x === v.style);
  const address = ADDRESSES.find((x) => x === v.address);
  const words = WORDS.find((x) => x === v.words);
  const speed = SPEEDS.find((x) => x === v.speed);
  if (!style || !address || !words || !speed) return null;
  const voices: MockChoices["voices"] = {};
  if (isRec(v.voices)) for (const [l, id] of Object.entries(v.voices)) if (isTalkLang(l) && typeof id === "string" && VOICE_ID.test(id)) voices[l] = id;
  return { voices, style, address, words, speed };
};
const parseJar = (v: unknown): Jar | null => {
  if (!isRec(v)) return null;
  const cur = choices(v.cur);
  if (!cur) return null;
  return { cur, prev: choices(v.prev), token: typeof v.token === "string" && /^[\w-]{8,64}$/.test(v.token) ? v.token : null, changed: [] };
};
const START: Jar = { cur: MOCK_START, prev: null, token: null, changed: [] };

const refusal = (error: unknown): Fail => {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) return error.code === "not_available" ? "not_available" : "expired";
    if (error.status === 409) return "changed";
    if (error.status === 429) return "limit";
    if (error.status === 422 || error.status === 400) return "invalid";
  }
  return "down";
};

export async function readTalkPrefs(token: string, language: unknown): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; mock: boolean; data: TalkPrefs }> {
  const mode = ownerTalkPrefs();
  if (mode === "off") return { mode: "off" };
  const l: TalkLang = isTalkLang(language) ? language : "en";
  if (mode === "mock") return { mode: "ok", mock: true, data: mockPrefs(l, (await readJar(MOCK_COOKIE, parseJar, START)).cur) };
  try {
    return { mode: "ok", mock: false, data: await getTalkPrefs(token, l) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function loadTalkPrefs(token: string, language: unknown): Promise<Out<TalkPrefs>> {
  const out = await readTalkPrefs(token, language);
  return out.mode === "ok" ? { ok: true, data: out.data } : { ok: false, error: out.mode === "off" ? "not_available" : "down" };
}

/** One change (a field and an id/value of the lists). */
export async function saveTalkPrefs(token: string, language: unknown, patch: unknown): Promise<Out<TalkPrefs>> {
  const mode = ownerTalkPrefs();
  const p = cleanPatch(patch);
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!isTalkLang(language) || p === null) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const jar = await readJar(MOCK_COOKIE, parseJar, START);
    const options = mockOptions(language);
    const next: MockChoices = { ...jar.cur, voices: { ...jar.cur.voices } };
    const field = Object.keys(p)[0] as Field;
    if (p.voice !== undefined) {
      if (!options.voices.some((v) => v.id === p.voice)) return { ok: false, error: "invalid" };
      next.voices[language] = p.voice;
    }
    if (p.style !== undefined) next.style = p.style as MockChoices["style"];
    if (p.address !== undefined) {
      if (!options.address.includes(p.address as MockChoices["address"])) return { ok: false, error: "invalid" };
      next.address = p.address as MockChoices["address"];
    }
    if (p.words !== undefined) next.words = p.words as MockChoices["words"];
    if (p.speed !== undefined) next.speed = p.speed as MockChoices["speed"];
    const token2 = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!(await writeJar(MOCK_COOKIE, { cur: next, prev: jar.cur, token: token2 }))) return { ok: false, error: "down" };
    return { ok: true, data: mockPrefs(language, next, token2, [field]) };
  }
  try {
    return { ok: true, data: await putTalkPrefs(token, language, p) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}

export async function undoTalkChange(token: string, language: unknown, undoToken: unknown): Promise<Out<TalkPrefs>> {
  const mode = ownerTalkPrefs();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!isTalkLang(language) || typeof undoToken !== "string") return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const jar = await readJar(MOCK_COOKIE, parseJar, START);
    if (!jar.prev || !jar.token || jar.token !== undoToken) return { ok: false, error: "expired" };
    if (!(await writeJar(MOCK_COOKIE, { cur: jar.prev, prev: null, token: null }))) return { ok: false, error: "down" };
    return { ok: true, data: mockPrefs(language, jar.prev) };
  }
  try {
    return { ok: true, data: await undoTalkPrefs(token, language, undoToken) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}

/** The sample of one option (the "▶ Hear it"): in mock mode only the words, no sound. */
export async function previewOption(token: string, language: unknown, option: unknown): Promise<Out<Sample>> {
  const mode = ownerTalkPrefs();
  const p: Patch | null = cleanPatch(option);
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!isTalkLang(language) || p === null) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const cur = (await readJar(MOCK_COOKIE, parseJar, START)).cur;
    const style = (p.style ?? cur.style) as MockChoices["style"];
    return { ok: true, data: { text: mockSample(language, style), audio: null } };
  }
  try {
    const got = await previewTalkPrefs(token, language, p);
    return got ? { ok: true, data: { text: got.text, audio: { contentType: got.contentType, base64: got.audioBase64 } } } : { ok: false, error: "down" };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}
