import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { validLine, type CampaignOpeningLine, type Lines, type OpeningLine, type Preview } from "@/lib/opening-line/types";

import { ApiContractError, ApiRequestError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The opening line of a call (job DT, ADR 0116), as C1's API has it, under `/v1/tenants/{id}/ai-assistant`, with the signed-in person's own token:
 *
 *   GET /opening-line               any member -> { mention_ai, lines: [{language, campaign_id, text}], campaign_overrides: [{campaign_id, mention_ai}], defaults: {<lang>: {with_ai, without_ai}}, placeholders, disclosure_notice }
 *   PUT /opening-line               Owner      { language, campaign_id?, text | null }   one language at a time; null = back to the default (the API has no DELETE verb)
 *   PUT /mention-ai                 Owner      { mention_ai, campaign_id? }              default ON; for a campaign null removes its override
 *   GET /voices/preview?language   Owner, Admin -> the sound (audio/wav) of the SAVED line, spoken with the business's real names in the voice in force (C1's voice picker contract); 404 no_preview = no voice service, 429 = too many
 *
 * The screens work with one workspace object ({lines by language, the default of each, the switch}) and one per campaign; this file is the one place that knows how the API cuts them. A text is 10 to 300 characters with only {customer} {assistant}
 * {business} {agent_role}. The API also has mr and bn (drafts); the screens have the six call languages, so those two are left out. "Hear it" can only speak what is SAVED (the API makes the sound from the stored line), so the editor asks to save first.
 */
const aiBase = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-assistant`;
};
const checkCampaign = (campaignId: string): string => {
  if (!isCanonicalUuid(campaignId)) throw new ApiContractError("id");
  return campaignId;
};

type Row = { language: CallLang; campaignId: string | null; text: string };
type Raw = { mentionAi: boolean; rows: Row[]; overrides: Map<string, boolean>; defaults: Record<CallLang, { withAi: string; withoutAi: string }> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCall = (l: unknown): l is CallLang => (CALL_LANGS as readonly unknown[]).includes(l);
function bad(): never {
  throw new ApiContractError("Unexpected body in an opening line response.");
}

export function parseRaw(json: unknown): Raw {
  if (!isRecord(json) || typeof json.mention_ai !== "boolean" || !Array.isArray(json.lines) || !Array.isArray(json.campaign_overrides) || !isRecord(json.defaults)) return bad();
  const rows: Row[] = [];
  for (const r of json.lines) {
    if (!isRecord(r) || typeof r.language !== "string" || typeof r.text !== "string" || (r.campaign_id !== null && typeof r.campaign_id !== "string")) return bad();
    if (!isCall(r.language)) continue; // mr and bn are not drawn
    if (!validLine(r.text)) return bad();
    rows.push({ language: r.language, campaignId: r.campaign_id as string | null, text: r.text });
  }
  const overrides = new Map<string, boolean>();
  for (const o of json.campaign_overrides) {
    if (!isRecord(o) || typeof o.campaign_id !== "string" || typeof o.mention_ai !== "boolean") return bad();
    overrides.set(o.campaign_id, o.mention_ai);
  }
  const defaults = {} as Raw["defaults"];
  for (const l of CALL_LANGS) {
    const d = json.defaults[l];
    if (!isRecord(d) || typeof d.with_ai !== "string" || typeof d.without_ai !== "string" || d.with_ai.length < 1 || d.without_ai.length < 1) return bad();
    defaults[l] = { withAi: d.with_ai, withoutAi: d.without_ai };
  }
  return { mentionAi: json.mention_ai, rows, overrides, defaults };
}

const defaultsFor = (raw: Raw, mentionAi: boolean): Record<CallLang, string> => Object.fromEntries(CALL_LANGS.map((l) => [l, mentionAi ? raw.defaults[l].withAi : raw.defaults[l].withoutAi])) as Record<CallLang, string>;
const linesOf = (raw: Raw, campaignId: string | null): Lines => {
  const out: Lines = {};
  for (const r of raw.rows) if (r.campaignId === campaignId) out[r.language] = r.text;
  return out;
};

/** The workspace's own: its texts, the default of each language (with or without the mention, as the switch now stands) and the switch. */
export const workspaceOf = (raw: Raw): OpeningLine => ({ lines: linesOf(raw, null), defaults: defaultsFor(raw, raw.mentionAi), mentionAi: raw.mentionAi, fake: false });

/** A campaign's own texts and switch (null = follows the business) and what the dialer will use. */
export function campaignOf(raw: Raw, campaignId: string): CampaignOpeningLine {
  const own = linesOf(raw, campaignId);
  const ws = linesOf(raw, null);
  const override = raw.overrides.has(campaignId) ? (raw.overrides.get(campaignId) as boolean) : null;
  const mention = override ?? raw.mentionAi;
  const defaults = defaultsFor(raw, mention);
  const lines = Object.fromEntries(CALL_LANGS.map((l) => [l, own[l] ?? ws[l] ?? defaults[l]])) as Record<CallLang, string>;
  return { lines: own, mentionAi: override, effective: { lines, mentionAi: mention } };
}

const readRaw = async (token: string, tenantId: string): Promise<Raw> => parseRaw(await apiRequest(`${aiBase(tenantId)}/opening-line`, token));
const putLine = async (token: string, tenantId: string, language: string, campaignId: string | null, text: string | null): Promise<Raw> =>
  parseRaw(await apiRequest(`${aiBase(tenantId)}/opening-line`, token, { method: "PUT", body: JSON.stringify({ language, ...(campaignId ? { campaign_id: campaignId } : {}), text }) }));
const putMention = async (token: string, tenantId: string, campaignId: string | null, mentionAi: boolean | null): Promise<Raw> =>
  parseRaw(await apiRequest(`${aiBase(tenantId)}/mention-ai`, token, { method: "PUT", body: JSON.stringify({ mention_ai: mentionAi, ...(campaignId ? { campaign_id: campaignId } : {}) }) }));

export const getOpeningLine = async (token: string, tenantId: string): Promise<OpeningLine> => workspaceOf(await readRaw(token, tenantId));

/** One request per language that changed, then the switch; the answer of the last is the whole picture. `lines`: a text, or null = back to the default. */
export async function putOpeningLine(token: string, tenantId: string, lines: Partial<Record<CallLang, string | null>>, mentionAi: boolean): Promise<OpeningLine> {
  for (const [language, text] of Object.entries(lines)) if (text !== undefined) await putLine(token, tenantId, language, null, text);
  return workspaceOf(await putMention(token, tenantId, null, mentionAi));
}

export async function getCampaignOpeningLine(token: string, tenantId: string, campaignId: string): Promise<CampaignOpeningLine> {
  checkCampaign(campaignId);
  return campaignOf(await readRaw(token, tenantId), campaignId);
}

export async function putCampaignOpeningLine(token: string, tenantId: string, campaignId: string, lines: Partial<Record<CallLang, string | null>>, mentionAi: boolean | null): Promise<CampaignOpeningLine> {
  checkCampaign(campaignId);
  for (const [language, text] of Object.entries(lines)) if (text !== undefined) await putLine(token, tenantId, language, campaignId, text);
  return campaignOf(await putMention(token, tenantId, campaignId, mentionAi), campaignId);
}

/** The seconds a WAV lasts, from its header (the byte rate and the size); 4 when the header is not the plain kind. */
export function wavSeconds(bytes: Uint8Array): number {
  if (bytes.length < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") return 4;
  const rate = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(28, true);
  const seconds = rate > 0 ? (bytes.length - 44) / rate : 4;
  return Math.min(Math.max(seconds, 0.5), 59);
}

/**
 * "Hear it": the sound of the SAVED opening line for one language, in the workspace's own voice (the voice chosen in Settings > AI assistant > Voice, else the default; the API picks it), with the business's real names. The API makes the
 * sound from what it has stored, so what is on the screen but not saved is not what is heard (the editor says so). null audio = the voice service has none.
 */
export async function previewOpeningLine(token: string, tenantId: string, language: CallLang): Promise<Preview> {
  try {
    const got = await apiBinaryRequest(`${aiBase(tenantId)}/voices/preview?${new URLSearchParams({ language }).toString()}`, token, 2_000_000);
    if (!/^audio\/(wav|x-wav|mpeg|ogg|mp4|webm)(;|$)/.test(got.contentType)) return { audio: null, fake: false };
    const bytes = new Uint8Array(got.bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const type = got.contentType.split(";")[0];
    return { audio: { base64: btoa(binary), mime: type === "audio/x-wav" ? "audio/wav" : type, seconds: wavSeconds(bytes) }, fake: false };
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    if (typeof error === "object" && error !== null && (error as { status?: number }).status === 404) return { audio: null, fake: false };
    throw error;
  }
}

/** The API has no "preview this text" yet (the route is missing): the caller falls back to the saved line, or says so. Not a refusal of the person's text. */
export class PreviewUnsupported extends Error {}

/**
 * "Hear it" for the line AS IT IS ON THE SCREEN, saved or not (C2 -> C1, 28 Oct): `POST /voices/preview {language, text, mention_ai}` (Owner, Admin). `text` is the line with its four placeholders (null = the saved line); the API fills the live names, applies the disclosure rule exactly as a call does,
 * speaks it in the voice in force and answers {spoken_text, audio: {mime, base64}}: `spoken_text` is the exact string it sent to the voice engine, shown under the button so that what is read is what was heard. Nothing is saved. 404 `no_preview` = no voice service (no sound);
 * a 404 / 405 of any other kind = the route is not there yet (PreviewUnsupported).
 */
export async function previewSpoken(token: string, tenantId: string, input: { language: CallLang; text: string | null; mentionAi: boolean | null }): Promise<Preview> {
  let json: unknown;
  try {
    json = await apiRequest(`${aiBase(tenantId)}/voices/preview`, token, { method: "POST", body: JSON.stringify({ language: input.language, text: input.text, mention_ai: input.mentionAi }) });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.code === "no_preview") return { audio: null, fake: false, spokenText: null };
      if (error.status === 404 || error.status === 405) throw new PreviewUnsupported();
    }
    throw error;
  }
  if (!isRecord(json) || typeof json.spoken_text !== "string" || json.spoken_text.trim() === "" || json.spoken_text.length > 2000) throw new ApiContractError("Unexpected opening-line preview.");
  const audio = isRecord(json.audio) ? json.audio : null;
  if (audio === null) return { audio: null, fake: false, spokenText: json.spoken_text };
  const mime = audio.mime === "audio/x-wav" ? "audio/wav" : audio.mime;
  if (typeof audio.base64 !== "string" || audio.base64.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(audio.base64) || typeof mime !== "string" || !/^audio\/(wav|mpeg|ogg|mp4|webm)$/.test(mime)) throw new ApiContractError("Unexpected opening-line preview audio.");
  const bytes = Uint8Array.from(atob(audio.base64), (c) => c.charCodeAt(0));
  return { audio: { base64: audio.base64, mime, seconds: mime === "audio/wav" ? wavSeconds(bytes) : 1 }, fake: false, spokenText: json.spoken_text };
}

/** The saved greeting exactly as a customer hears it, with the real names: `GET /opening-line/preview?language` {text}. The sound of `GET /voices/preview` is made from the same text, so this is what that sound says. null when the API has none. */
export async function savedGreetingText(token: string, tenantId: string, language: CallLang): Promise<string | null> {
  try {
    const json = await apiRequest(`${aiBase(tenantId)}/opening-line/preview?${new URLSearchParams({ language }).toString()}`, token);
    return isRecord(json) && typeof json.text === "string" && json.text.trim() !== "" && json.text.length <= 2000 ? json.text : null;
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    return null;
  }
}

export type { Lines };
