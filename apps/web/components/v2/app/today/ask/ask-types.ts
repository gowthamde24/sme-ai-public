/**
 * What the "Ask your team" box needs from the Agent OWL, as the box reads it. The answer of the real Agent OWL (Job AG, `POST /v1/tenants/{id}/assistant/messages`, server-sent events
 * of `text`, `source`, `draft`, `error` and `done`) is read by this app's own route (`app/app/tenants/[tenantId]/ask/route.ts`, with the signed-in person's token, which the browser never
 * holds) and passed on in THIS shape: each `target` ({type, id}) is already a path inside the workspace, or null when there is no screen. `transport.ts` reads that stream.
 * Everything an event carries is untrusted text (it can quote a customer's e-mail): the box draws it as plain text, never as markup, and follows a link only when it points inside this workspace.
 */
export type AskEvent =
  /** Progress, sent at once so the answer's stream opens before the answer is ready (job DG). The box shows its own waiting line and ignores it; it is never part of the answer. */
  | { type: "step" }
  /** The next piece of the answer, in the order it was written. */
  | { type: "text"; delta: string }
  /** Where a fact in the answer came from. `href` is a path inside this workspace, or null when the record has no screen of its own (a company, a price item). */
  | { type: "source"; label: string; href: string | null }
  /**
   * A draft the Agent OWL prepared. It is only a draft: a person approves it on the screen `href` names, or, when `href` is null (a customer reply has no approving screen yet), nowhere.
   * A customer reply carries the text in the customer's language (`summary`, `language`) and its English meaning (`gloss`); `machine` is true when a machine wrote the words.
   */
  | { type: "draft"; id: string; kind: string; title: string; summary: string; href: string | null; language?: string | null; gloss?: string | null; machine?: boolean }
  /** The answer could not be completed. Nothing was changed. `code` is one of a short closed list (see ERROR_CODES); anything else is the general sentence. */
  | { type: "error"; code?: string }
  | { type: "done" }
  /** Voice only (job BF): the words the recording was heard as. The box shows them as the person's own message. */
  | { type: "heard"; text: string }
  /** Voice only: the spoken answer (base64, after the written one). The written answer stands without it. */
  | { type: "audio"; contentType: string; data: string }
  /** Voice only: the spoken answer could not be made. The written answer stands. */
  | { type: "audio_error"; code?: string };

/** Why an answer was refused or failed, in the words the box has a fixed sentence for. */
export const ERROR_CODES = [
  "ai_paused_until", "run_limit_reached", "agents_disabled", "forbidden", "model_busy", "model_not_configured",
  // voice (job BF): the recording was too long or too short, nothing could be heard, voice is not on, the speech service failed; `network` is made in the browser when the request cannot be made
  "voice_too_long", "voice_too_short", "voice_no_speech", "voice_unavailable", "voice_failed", "network",
] as const;

export type AskRequest = { question: string; lang: string; signal: AbortSignal };
export type AskTransport = (request: AskRequest) => AsyncIterable<AskEvent>;

/** A recording to ask with (job BF). `speak`: also ask for the answer to be spoken. */
export type VoiceRequest = { audio: Blob; lang: string; speak: boolean; signal: AbortSignal };
export type VoiceTransport = (request: VoiceRequest) => AsyncIterable<AskEvent>;
/** What the API says about voice for this person: `available` = a mic may be shown; `speech` = it can also speak the answer. */
export type VoiceStatus = { available: boolean; speech: boolean };

export type AskSource = { label: string; href: string | null };
export type AskDraft = { id: string; kind: string; title: string; summary: string; href: string | null; language: string | null; gloss: string | null; machine: boolean };

/** `live`: the box can ask. The other two say why it cannot: the Agent OWL is not built (`not_available`) or its switch is off (`switched_off`). */
export type Availability = "live" | "not_available" | "switched_off";
