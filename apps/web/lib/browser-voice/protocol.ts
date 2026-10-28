/**
 * "Talk to your assistant" in the browser (job DV, C1's contract-browser-voice.md, ADR 0118): the messages of the WebSocket `wss://<api>/v1/tenants/{id}/voice-chat`, checked as they arrive (the API's words are untrusted text and are drawn as plain text),
 * and the closed words for every refusal. Text frames are JSON; binary frames are audio (to the API: PCM 16-bit little-endian, 16 kHz, mono; from it: PCM 16-bit LE, 24 kHz, mono).
 */
export const VOICE_LANGS = ["te", "en", "hi", "kn"] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
export const isVoiceLang = (v: unknown): v is VoiceLang => (VOICE_LANGS as readonly unknown[]).includes(v);

export const IN_RATE = 16_000;
export const OUT_RATE = 24_000;

export type VoiceState = "listening" | "thinking" | "speaking";
export type Step = "working" | "looking";
export type LimitReason = "session" | "daily_limit" | "idle";
/** A source the answer rests on (as Ask's): its words only; the browser draws them, it does not follow a link of the API's. */
export type VoiceSource = { kind: string; label: string };

export type ServerMessage =
  | { type: "ready"; sessionId: string; language: VoiceLang; sessionSeconds: number | null; daySecondsLeft: number | null }
  | { type: "state"; state: VoiceState; step: Step | null }
  | { type: "caption"; who: "user" | "assistant"; text: string; final: boolean; spoken: boolean }
  | { type: "audio_end"; turn: number }
  | { type: "audio_stop" }
  | { type: "interrupted"; ms: number }
  | ({ type: "source" } & VoiceSource)
  | { type: "draft" }
  | { type: "timings"; turn: number; tier: string; firstSoundMs: number | null }
  | { type: "language"; language: VoiceLang }
  | { type: "error"; code: string; message: string; fatal: boolean }
  | { type: "limit"; reason: LimitReason }
  | { type: "pong" };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** One text frame of the API, or null for anything that is not one of its messages. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string" || raw.length > 20_000) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(json) || typeof json.type !== "string") return null;
  switch (json.type) {
    case "ready": {
      const limits = isRec(json.limits) ? json.limits : {};
      return isVoiceLang(json.language) && typeof json.session_id === "string" ? { type: "ready", sessionId: json.session_id.slice(0, 80), language: json.language, sessionSeconds: num(limits.session_seconds), daySecondsLeft: num(limits.day_seconds_left) } : null;
    }
    case "state": {
      if (json.state !== "listening" && json.state !== "thinking" && json.state !== "speaking") return null;
      return { type: "state", state: json.state, step: json.step === "working" || json.step === "looking" ? json.step : null };
    }
    case "caption": {
      const t = text(json.text, 4000);
      if ((json.who !== "user" && json.who !== "assistant") || t === null) return null;
      return { type: "caption", who: json.who, text: t, final: json.final !== false, spoken: json.spoken !== false };
    }
    case "audio_end":
      return { type: "audio_end", turn: num(json.turn) ?? 0 };
    case "audio_stop":
      return { type: "audio_stop" };
    case "interrupted":
      return { type: "interrupted", ms: num(json.ms) ?? 0 };
    case "source": {
      const label = text(json.label, 300);
      return label === null ? null : { type: "source", kind: typeof json.kind === "string" ? json.kind.slice(0, 40) : "", label };
    }
    case "draft":
      return { type: "draft" };
    case "timings":
      return { type: "timings", turn: num(json.turn) ?? 0, tier: typeof json.tier === "string" ? json.tier.slice(0, 20) : "", firstSoundMs: num(json.first_sound_ms) };
    case "language":
      return isVoiceLang(json.language) ? { type: "language", language: json.language } : null;
    case "error": {
      const code = text(json.code, 60);
      const message = text(json.message, 400);
      return code === null || message === null ? null : { type: "error", code, message, fatal: json.fatal === true };
    }
    case "limit":
      return json.reason === "session" || json.reason === "daily_limit" || json.reason === "idle" ? { type: "limit", reason: json.reason } : null;
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

/** The closed words for an end of the session (the keys are `bv.end.*`): from a `limit` message, a fatal `error` or the close code. */
export type EndWord = "session" | "daily" | "idle" | "busy" | "rate" | "signin" | "refused" | "gone" | "unavailable" | "left";
export function endWordOf(close: { code: number; reason?: string } | null, last: { limit?: LimitReason; errorCode?: string } = {}): EndWord {
  if (last.limit === "session") return "session";
  if (last.limit === "daily_limit") return "daily";
  if (last.limit === "idle") return "idle";
  if (last.errorCode === "busy") return "busy";
  if (last.errorCode === "rate_limited") return "rate";
  if (last.errorCode === "daily_limit") return "daily";
  const code = close?.code ?? 1000;
  if (code === 4401) return "signin";
  if (code === 4403) return "refused";
  if (code === 4404) return "gone";
  if (code === 4429) return "busy";
  if (code === 4503) return "unavailable";
  return code === 1000 ? "left" : "unavailable";
}

/** The messages to the API. */
export const startMessage = (accessToken: string, language: VoiceLang): string => JSON.stringify({ type: "start", access_token: accessToken, language });
export const BARGE_IN = JSON.stringify({ type: "barge_in" });
export const STOP = JSON.stringify({ type: "stop" });
export const PING = JSON.stringify({ type: "ping" });
export const setLanguageMessage = (language: VoiceLang): string => JSON.stringify({ type: "set_language", language });

/** The address of the socket for a workspace, from the API's https address (never from anything the browser holds). null when the address is not a plain http(s) one. */
export function voiceSocketUrl(apiBase: string, tenantId: string): string | null {
  try {
    const u = new URL(apiBase);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/v1/tenants/${encodeURIComponent(tenantId)}/voice-chat`;
  } catch {
    return null;
  }
}
