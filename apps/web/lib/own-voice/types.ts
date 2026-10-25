/**
 * The Owner's own voice, with consent (job DP; C1's contract-own-voice.md). Only the Owner, with the second factor, makes or deletes it; an Admin sees the status. We keep the consent recording, the name and the time; no
 * answer returns a recording or a link to one. The assistant still says it is the AI assistant. These are the shapes the screen reads; every answer is checked.
 */
export const STATUSES = ["none", "pending", "ready", "failed", "deleted"] as const;
export type OwnVoiceStatus = (typeof STATUSES)[number];
export type OwnVoice = { status: OwnVoiceStatus; consentingName: string | null; consentedAt: string | null; sampleSeconds: number | null; consentSeconds: number | null; readyAt: string | null; deletedAt: string | null; saysAiAssistant: boolean; fake: boolean };

/** The seconds a recording must be: the sample 15 to 60, the spoken consent 2 to 30. */
export const SAMPLE_SECONDS = { min: 15, max: 60 } as const;
export const CONSENT_SECONDS = { min: 2, max: 30 } as const;
export const SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
export const CONSENT_MAX_BYTES = 3 * 1024 * 1024;
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a", "video/webm", "video/mp4"] as const;
/** The voice's name as the assistant's settings call it (`voice_persona`). */
export const OWN_VOICE_PERSONA = "own_voice";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const when = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const secs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600 ? v : null);

export function parseOwnVoice(json: unknown): OwnVoice | null {
  if (!isRecord(json) || !(STATUSES as readonly unknown[]).includes(json.status)) return null;
  return {
    status: json.status as OwnVoiceStatus,
    consentingName: str(json.consenting_name, 80),
    consentedAt: when(json.consented_at),
    sampleSeconds: secs(json.sample_seconds),
    consentSeconds: secs(json.consent_seconds),
    readyAt: when(json.ready_at),
    deletedAt: when(json.deleted_at),
    saysAiAssistant: json.says_ai_assistant !== false,
    fake: json.fake !== false,
  };
}
export const parseSentence = (json: unknown): string | null => (isRecord(json) && typeof json.sentence === "string" && json.sentence.length > 10 && json.sentence.length <= 400 ? json.sentence : null);

/** A name the person may sign the consent with: letters (any script), digits, spaces, dots, hyphens and apostrophes; at most 80. */
export const validConsentName = (v: unknown): v is string => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 80 && /^[\p{L}\p{M}\p{N} .'-]+$/u.test(v.trim()) && /\p{L}/u.test(v);
/** The sentence the person reads (the same words as the API's, for the mock; the real one comes from `GET /voice-clone/sentence`). */
export const consentSentence = (name: string, business: string): string => `I, ${name.trim()}, allow Stack19 to create an AI voice of me for ${business}`;
