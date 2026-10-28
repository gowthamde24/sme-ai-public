import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getCampaignOpeningLine, getOpeningLine, previewOpeningLine, putCampaignOpeningLine, putOpeningLine } from "@/lib/api/opening-line";
import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { readJar, writeJar } from "@/lib/mock/jar";
import { openingLineScreens } from "@/lib/screens/flag";

import { MOCK_DEFAULTS, validLine, type CampaignOpeningLine, type Lines, type OpeningLine, type Preview } from "./types";

/**
 * Where the opening-line editor gets its words and saves them (night 5). `mock` = ONE small cookie for the workspace (and one per campaign): the texts and the switch, never a sound; `on` = C1's API (lib/api/opening-line.ts, an ASSUMED contract until
 * it is merged); `off` = the part is not there. Every move checks its input again here (the browser is not trusted): a text is 10 to 300 characters with only the four placeholders, a language is one of the six. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string };
export const MOCK_COOKIE = "sme_openingline_mock";
const campaignCookie = (campaignId: string): string => `${MOCK_COOKIE}_${campaignId.slice(0, 8)}`;
export type SaveError = "invalid" | "forbidden" | "read_only" | "not_available" | "down";
export type Saved<T> = { ok: true; data: T } | { ok: false; error: SaveError };
export type Edit = { lines: Partial<Record<CallLang, string | null>>; mentionAi: boolean };

type Stored = { lines: Lines; ai: boolean };
const parseStored = (v: unknown): Stored | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lines: Lines = {};
  if (typeof o.lines === "object" && o.lines !== null) for (const l of CALL_LANGS) if (validLine((o.lines as Record<string, unknown>)[l])) lines[l] = (o.lines as Record<string, string>)[l];
  return { lines, ai: o.ai !== false };
};
const parseCampaignStored = (v: unknown): { lines: Lines; ai: boolean | null } | null => {
  const s = parseStored(v);
  if (!s) return null;
  const raw = (v as Record<string, unknown>).ai;
  return { lines: s.lines, ai: raw === true || raw === false ? raw : null };
};

/** What a person may send: the six languages only, each a valid text or null (back to the default), and a yes or no. Anything else is refused. */
export function parseEdit(input: unknown, allowInherit = false): { lines: Partial<Record<CallLang, string | null>>; mentionAi: boolean | null } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.lines !== "object" || o.lines === null || Array.isArray(o.lines)) return null;
  const lines: Partial<Record<CallLang, string | null>> = {};
  for (const [k, v] of Object.entries(o.lines)) {
    if (!(CALL_LANGS as readonly string[]).includes(k)) return null;
    if (v === null) lines[k as CallLang] = null;
    else if (validLine(v)) lines[k as CallLang] = v.trim();
    else return null;
  }
  const ai = o.mentionAi;
  if (ai === null && allowInherit) return { lines, mentionAi: null };
  if (typeof ai !== "boolean") return null;
  return { lines, mentionAi: ai };
}

const refusal = (error: unknown): SaveError => {
  if (error instanceof ApiRequestError) {
    if (error.code === "workspace_read_only") return "read_only";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return "invalid";
  }
  return "down";
};
const merge = (old: Lines, edit: Partial<Record<CallLang, string | null>>): Lines => {
  const out: Lines = { ...old };
  for (const [l, v] of Object.entries(edit)) if (v === null) delete out[l as CallLang];
  else if (typeof v === "string") out[l as CallLang] = v;
  return out;
};

export async function readOpeningLine(ctx: Ctx): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: OpeningLine }> {
  const mode = openingLineScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") {
    const s = await readJar(MOCK_COOKIE, parseStored, { lines: {}, ai: true });
    return { mode: "ok", data: { lines: s.lines, defaults: MOCK_DEFAULTS, mentionAi: s.ai, fake: true } };
  }
  try {
    return { mode: "ok", data: await getOpeningLine(ctx.token, ctx.tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function saveOpeningLine(ctx: Ctx, input: unknown): Promise<Saved<OpeningLine>> {
  const mode = openingLineScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const edit = parseEdit(input);
  if (!edit || edit.mentionAi === null) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const old = await readJar(MOCK_COOKIE, parseStored, { lines: {}, ai: true });
    const next = { lines: merge(old.lines, edit.lines), ai: edit.mentionAi };
    if (!(await writeJar(MOCK_COOKIE, next))) return { ok: false, error: "invalid" };
    return { ok: true, data: { lines: next.lines, defaults: MOCK_DEFAULTS, mentionAi: next.ai, fake: true } };
  }
  try {
    return { ok: true, data: await putOpeningLine(ctx.token, ctx.tenantId, edit.lines, edit.mentionAi) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}

const mockEffective = async (own: { lines: Lines; ai: boolean | null }): Promise<CampaignOpeningLine> => {
  const ws = await readJar(MOCK_COOKIE, parseStored, { lines: {}, ai: true });
  const lines = Object.fromEntries(CALL_LANGS.map((l) => [l, own.lines[l] ?? ws.lines[l] ?? MOCK_DEFAULTS[l]])) as Record<CallLang, string>;
  return { lines: own.lines, mentionAi: own.ai, effective: { lines, mentionAi: own.ai ?? ws.ai } };
};

export async function readCampaignOpeningLine(ctx: Ctx, campaignId: string): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: CampaignOpeningLine }> {
  const mode = openingLineScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", data: await mockEffective(await readJar(campaignCookie(campaignId), parseCampaignStored, { lines: {}, ai: null })) };
  try {
    return { mode: "ok", data: await getCampaignOpeningLine(ctx.token, ctx.tenantId, campaignId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function saveCampaignOpeningLine(ctx: Ctx, campaignId: string, input: unknown): Promise<Saved<CampaignOpeningLine>> {
  const mode = openingLineScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const edit = parseEdit(input, true);
  if (!edit) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const old = await readJar(campaignCookie(campaignId), parseCampaignStored, { lines: {}, ai: null });
    const next = { lines: merge(old.lines, edit.lines), ai: edit.mentionAi };
    if (!(await writeJar(campaignCookie(campaignId), next))) return { ok: false, error: "invalid" };
    return { ok: true, data: await mockEffective(next) };
  }
  try {
    return { ok: true, data: await putCampaignOpeningLine(ctx.token, ctx.tenantId, campaignId, edit.lines, edit.mentionAi) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}

/** The spoken preview of the line that is SAVED (the API makes the sound from what it stores; `text` is only checked as a sign that there is a line on the screen). In `mock` there is no sound: `audio` is null and the screen says the text above is what would be said. */
export async function previewLine(ctx: Ctx, language: unknown, text: unknown): Promise<Saved<Preview>> {
  const mode = openingLineScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (typeof language !== "string" || !(CALL_LANGS as readonly string[]).includes(language) || typeof text !== "string" || text.trim().length < 2 || text.length > 400) return { ok: false, error: "invalid" };
  if (mode === "mock") return { ok: true, data: { audio: null, fake: true } };
  try {
    return { ok: true, data: await previewOpeningLine(ctx.token, ctx.tenantId, language as CallLang) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { ok: false, error: refusal(error) };
  }
}
