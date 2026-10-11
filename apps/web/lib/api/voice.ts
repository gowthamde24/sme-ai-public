import { ApiAuthError, ApiContractError, ApiRequestError, apiStreamUpload } from "./client";
import { ASSISTANT_LANGUAGES, parseAssistantEvent, readSse, type AssistantEvent, type AssistantLanguage } from "./assistant";
import { isCanonicalUuid } from "./crm";

/**
 * Voice in the Ask box (job BF; the API side is job BD, `POST /v1/tenants/{id}/assistant/voice`). Server side only, with the signed-in person's own token: the browser sends the recording to this app's
 * own route, which forwards it here. The recording is held in memory for the length of the request; this app never stores it.
 *
 * The answer is the text route's events plus three of its own: `transcript` (what was heard, shown as the person's message), `audio` (the spoken answer, base64, after the text) and `audio_error`
 * (the spoken answer failed; the text answer stands).
 */
export type VoiceEvent =
  | { type: "transcript"; text: string; language: AssistantLanguage | null; seconds: number; reused: boolean }
  | { type: "audio"; contentType: string; data: string; characters: number }
  | { type: "audio_error"; code: string };

export type VoiceAssistantEvent = AssistantEvent | VoiceEvent;

/** What a spoken answer may be: the types the speech providers return and every browser plays. */
export const AUDIO_TYPES = ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"] as const;
/** About 6 MB of audio: far above a 500-character spoken answer, and a bound on what one answer can put in a page. */
export const MAX_AUDIO_BASE64 = 8_000_000;
/** The API holds a WebM or Ogg recording to 1.5 MB (the 60 seconds of speech at a low bit rate are far below it); checked here too so a bad file is refused before it travels. */
export const MAX_RECORDING_BYTES = 1_500_000;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a voice response.`);
};

/** One server-sent event of the voice route. The three voice events are read here; every other event is the text route's and is read by its own parser. */
export function parseVoiceEvent(name: string, data: unknown): VoiceAssistantEvent | null {
  switch (name) {
    case "transcript": {
      if (!isRecord(data) || data.type !== "transcript" || typeof data.text !== "string" || data.text.length > 4000) return bad("transcript");
      const language = typeof data.language === "string" && (ASSISTANT_LANGUAGES as readonly string[]).includes(data.language) ? (data.language as AssistantLanguage) : null;
      const seconds = typeof data.seconds === "number" && Number.isFinite(data.seconds) && data.seconds >= 0 && data.seconds <= 600 ? data.seconds : 0;
      return { type: "transcript", text: data.text, language, seconds, reused: data.reused === true };
    }
    case "audio": {
      if (!isRecord(data) || data.type !== "audio") return bad("audio");
      const contentType = typeof data.content_type === "string" ? data.content_type.toLowerCase().split(";")[0].trim() : "";
      if (!(AUDIO_TYPES as readonly string[]).includes(contentType) || data.encoding !== "base64") return bad("audio type");
      if (typeof data.data !== "string" || data.data.length < 1 || data.data.length > MAX_AUDIO_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) return bad("audio data");
      return { type: "audio", contentType, data: data.data, characters: typeof data.characters === "number" && Number.isFinite(data.characters) ? data.characters : 0 };
    }
    case "audio_error":
      return isRecord(data) && data.type === "audio_error" && typeof data.code === "string" ? { type: "audio_error", code: data.code.slice(0, 40) } : bad("audio_error");
    default:
      return parseAssistantEvent(name, data);
  }
}

export interface SendVoiceInput {
  messageId: string;
  conversationId?: string;
  language?: AssistantLanguage;
  /** Ask for the answer to be spoken too. */
  speak: boolean;
  audio: ArrayBuffer;
  contentType: string;
}

const AUDIO_CONTAINER = /^audio\/(webm|ogg|mp4|x-m4a|m4a|mpeg|mp3|wav|x-wav|flac)(;.*)?$/i;

/** `POST /v1/tenants/{tenant}/assistant/voice`: a recording in, the transcript, the answer's events and optionally the spoken answer out. Throws before the first event when the API refuses (ApiRequestError: 503 voice_unavailable, 429 ai_paused_until, 413/415/422 for the recording, 403, 409). */
export async function* sendVoiceMessage(accessToken: string, tenantId: string, input: SendVoiceInput): AsyncGenerator<VoiceAssistantEvent> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input.messageId) || (input.conversationId !== undefined && !isCanonicalUuid(input.conversationId))) throw new ApiContractError("id");
  if (input.audio.byteLength < 1 || input.audio.byteLength > MAX_RECORDING_BYTES || !AUDIO_CONTAINER.test(input.contentType)) throw new ApiContractError("recording");
  if (input.language !== undefined && !(ASSISTANT_LANGUAGES as readonly string[]).includes(input.language)) throw new ApiContractError("language");
  const query = new URLSearchParams({ message_id: input.messageId, speak: input.speak ? "true" : "false" });
  if (input.conversationId) query.set("conversation_id", input.conversationId);
  if (input.language) query.set("language", input.language);
  const response = await apiStreamUpload(`/v1/tenants/${tenantId}/assistant/voice?${query.toString()}`, accessToken, input.audio, input.contentType.split(";")[0].trim());
  for await (const { name, data } of readSse(response.body as ReadableStream<Uint8Array>)) {
    const event = parseVoiceEvent(name, data);
    if (event !== null) yield event;
  }
}

export type VoiceAvailability = { available: boolean; speech: boolean };

/**
 * Whether voice is on for this person in this business, asked of the API itself (it has no separate "capabilities" answer): an EMPTY recording is sent to the voice route, which answers before it hears
 * or charges anything. 503 `voice_unavailable` = off; 422 `speech_unavailable` = it hears but cannot speak; 403 = this role may not use it; any other refusal of the empty recording (too short,
 * unreadable) = it is on, with speech. A network failure or a server error means "not known": no mic is shown.
 */
export async function probeVoice(accessToken: string, tenantId: string, id: string = crypto.randomUUID()): Promise<VoiceAvailability> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const off: VoiceAvailability = { available: false, speech: false };
  try {
    await apiStreamUpload(`/v1/tenants/${tenantId}/assistant/voice?message_id=${id}&speak=true`, accessToken, new ArrayBuffer(0), "audio/webm");
    return { available: true, speech: true }; // an empty recording is never accepted; if it is, the route is there
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (!(error instanceof ApiRequestError)) return off;
    if (error.code === "voice_unavailable" || error.status === 403 || error.status === 404 || error.status >= 500) return off;
    if (error.code === "speech_unavailable") return { available: true, speech: false };
    if (error.status === 413 || error.status === 415 || error.status === 422 || error.status === 429) return { available: true, speech: true };
    return off;
  }
}
