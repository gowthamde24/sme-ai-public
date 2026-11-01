import type { ConfirmAction } from "@/lib/api/turns";

import type { AskEvent, AskTransport, VoiceStatus, VoiceTransport } from "./ask-types";

const AUDIO_TYPE = /^audio\/(wav|x-wav|wave|mpeg|mp3|ogg|webm|mp4|aac)$/; // the same nine as lib/api/voice.ts

/** One line of the route's answer as an AskEvent, or null for anything that is not one: the stream is this app's own, but its text is still untrusted and nothing is guessed. */
export function parseLine(raw: string): AskEvent | null {
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof e !== "object" || e === null) return null;
  const r = e as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  switch (r.type) {
    case "text":
      return typeof r.delta === "string" ? { type: "text", delta: r.delta } : null;
    case "source":
      return typeof r.label === "string" && (r.href === null || typeof r.href === "string") ? { type: "source", label: r.label, href: r.href } : null;
    case "draft":
      return typeof r.id === "string" && typeof r.kind === "string" && typeof r.title === "string" && typeof r.summary === "string" && (r.href === null || typeof r.href === "string")
        ? { type: "draft", id: r.id, kind: r.kind, title: r.title, summary: r.summary, href: r.href, language: s(r.language), gloss: s(r.gloss), machine: r.machine === true }
        : null;
    case "error":
    case "audio_error":
      return { type: r.type, code: s(r.code) ?? undefined };
    case "heard":
      return typeof r.text === "string" ? { type: "heard", text: r.text } : null;
    case "audio":
      return typeof r.contentType === "string" && AUDIO_TYPE.test(r.contentType) && typeof r.data === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(r.data) ? { type: "audio", contentType: r.contentType, data: r.data } : null;
    case "confirm_action":
      return r.action instanceof Object ? { type: "confirm_action", action: r.action as ConfirmAction } : null; // the route made it from the API's plan, already read there
    case "done":
      return { type: "done", conversationId: s(r.conversationId) };
    default:
      return null;
  }
}

/** How long the stream may say nothing at all before the answer is given up as stalled (a typed answer starts within seconds; the route also sends a quiet line now and then while the assistant works). */
export const STALL_MS = 90_000;

/** The route's answer as events: one JSON event per line, each read as it completes. The answer is whole only when it said `done` or `error`; a stream that stops before that ends with an `error` event (unless the person stopped it). */
async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let ended = false;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<"stalled">((resolve) => {
        timer = setTimeout(() => resolve("stalled"), STALL_MS);
      });
      const got = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
      if (got === "stalled") {
        if (!signal.aborted) yield { type: "error" }; // a long stall: the same ending as a cut connection
        return;
      }
      const { value, done } = got;
      buffer += decoder.decode(value, { stream: !done });
      let cut = buffer.indexOf("\n");
      while (cut !== -1) {
        const event = parseLine(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 1);
        if (event) {
          yield event;
          if (event.type === "done" || event.type === "error") ended = true;
        }
        cut = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } catch {
    if (!signal.aborted) yield { type: "error" };
    return;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!ended && !signal.aborted) yield { type: "error" }; // the stream stopped before its last word
}

/**
 * The Agent OWL's answer as an AskTransport: the question goes to this workspace's own route (`<base>/ask`), which holds the person's token and asks the Agent OWL; the answer comes back
 * as one JSON event per line. The chat is one for the life of the box (a conversation id made here, so a follow-up question continues it) and every question is a NEW message id, so a
 * question sent again after a failure is never taken for a replay. A reply that is not the event stream (a sign-in page, an error page) is a failed answer, not text to show.
 */
export function makeAskTransport(endpoint: string, fetcher: typeof fetch = (...a) => fetch(...a)): AskTransport {
  const conversationId = crypto.randomUUID();
  return async function* ask({ question, signal, conversationId: given, replyLanguage }) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question, messageId: crypto.randomUUID(), conversationId: given === undefined ? conversationId : given, ...(replyLanguage ? { language: replyLanguage } : {}) }),
        signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
    } catch {
      yield { type: "error" };
      return;
    }
    if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").startsWith("application/x-ndjson")) {
      yield { type: "error" };
      return;
    }
    yield* readEvents(response.body, signal);
  };
}

/**
 * The same answer for a RECORDING (job BF): the recording goes to `<endpoint>` as the request body (its own content type), the chat's ids and the language in the query. `speak` asks for the answer to be
 * spoken as well; the audio arrives as the last event, after `done`. The chat is the one the text transport would use only if the two share a conversation id: they do not need to, each is its own chat.
 */
export function makeVoiceTransport(endpoint: string, fetcher: typeof fetch = (...a) => fetch(...a)): VoiceTransport {
  const conversationId = crypto.randomUUID();
  return async function* voice({ audio, lang, speak, signal }) {
    let response: Response;
    try {
      const query = new URLSearchParams({ messageId: crypto.randomUUID(), conversationId, lang, speak: speak ? "1" : "0" });
      response = await fetcher(`${endpoint}?${query.toString()}`, {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/webm" },
        body: audio,
        signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
    } catch {
      if (!signal.aborted) yield { type: "error", code: "network" };
      return;
    }
    if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").startsWith("application/x-ndjson")) {
      yield { type: "error" };
      return;
    }
    yield* readEvents(response.body, signal);
  };
}

/** Whether to draw a microphone: asks this workspace's own voice route (which asks the API). Anything but a clear "yes" is "no": a failed or odd answer never shows a button that would not work. */
export async function fetchVoiceStatus(endpoint: string, signal?: AbortSignal, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<VoiceStatus> {
  const none: VoiceStatus = { available: false, speech: false };
  try {
    const response = await fetcher(endpoint, { method: "GET", signal, cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (!response.ok) return none;
    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) return none;
    const r = json as Record<string, unknown>;
    return r.available === true ? { available: true, speech: r.speech === true } : none;
  } catch {
    return none;
  }
}
