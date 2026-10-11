import { ERROR_CODES, type AskEvent } from "@/components/v2/app/today/ask/ask-types";
import type { Target } from "@/lib/api/assistant";
import type { ApiRequestError } from "@/lib/api/client";
import type { VoiceAssistantEvent } from "@/lib/api/voice";

/** What one answer may carry to the browser. The box keeps the same limits; keeping them here too bounds the lookups a single answer can cause. */
export const MAX_SOURCES = 8;
export const MAX_DRAFTS = 5;

/** The enquiry a quote belongs to (a quote has no page of its own), or null when it cannot be read. */
export type QuoteLookup = (quoteId: string) => Promise<string | null>;

/**
 * The page of THIS workspace that a `target` ({type, id} from the Agent OWL) opens. The path is built here from a type the API cannot invent (the parser accepts only these eight) and
 * an id that is a canonical uuid: no part of it is text from the answer. A quote opens the enquiry it belongs to; when that cannot be found it opens the list of quotes.
 */
export async function pathFor(target: Target | null, base: string, enquiryOfQuote: QuoteLookup): Promise<string | null> {
  if (target === null) return null;
  switch (target.type) {
    case "order":
      return `${base}/orders/${target.id}`;
    case "lead":
      return `${base}/leads/${target.id}`;
    case "enquiry":
      return `${base}/enquiries/${target.id}`;
    case "quote": {
      const enquiry = await enquiryOfQuote(target.id);
      return enquiry ? `${base}/enquiries/${enquiry}?quote=${target.id}` : `${base}/quotes`;
    }
    case "outbox_message":
    case "call_request":
      return `${base}#needs-you`; // decided on Today itself (job AU): the link goes to the list of what needs the person
    case "store_visit":
      return `${base}/visits?visit=${target.id}`; // the Visits page opens on the day of that visit (job AV)
    case "catalogue_item":
      return `${base}/catalogue/${target.id}`; // the saree's page (job BC)
  }
}

/** A code the box has a fixed sentence for, or nothing: the API's own sentence is English and is never passed on. */
export function knownCode(code: string): string | undefined {
  return (ERROR_CODES as readonly string[]).includes(code) ? code : undefined;
}

/** The API's refusal of a RECORDING as a code the box has a sentence for (job BF). The API's own sentences are English and are never passed on. */
export function voiceErrorCode(error: ApiRequestError): string | undefined {
  if (error.status === 403) return "forbidden";
  switch (error.code) {
    case "audio_too_long":
    case "audio_too_large":
      return "voice_too_long";
    case "audio_too_short":
      return "voice_too_short";
    case "no_speech":
      return "voice_no_speech";
    case "voice_unavailable":
    case "speech_unavailable":
      return "voice_unavailable";
    case "api_unreachable":
      return "network";
    case "voice_failed":
    case "voice_timeout":
    case "audio_unsupported":
    case "audio_unreadable":
    case "language_unsupported":
    case "validation_error":
      return "voice_failed";
    default:
      return knownCode(error.code);
  }
}

/**
 * The Agent OWL's events (Job AG) as the Ask box's events: a `target` becomes a path inside the workspace, the fields the box does not draw (`status`, `kind` of a source, the chat's ids)
 * are dropped, the number of sources and drafts is capped, and an error keeps only its code if the box knows it. Anything thrown while reading the stream ends the answer with an error event,
 * so the browser always gets a last word and never a half-open answer.
 */
export async function* toAskEvents(events: AsyncIterable<VoiceAssistantEvent>, base: string, enquiryOfQuote: QuoteLookup, options: { voice?: boolean } = {}): AsyncGenerator<AskEvent> {
  let sources = 0;
  let drafts = 0;
  let finished = false;
  for await (const e of events) {
    if (finished && e.type !== "audio" && e.type !== "audio_error") continue; // voice: after `done` only the spoken answer may still come
    switch (e.type) {
      case "transcript":
        yield { type: "heard", text: e.text.slice(0, 4000) };
        break;
      case "audio":
        yield { type: "audio", contentType: e.contentType, data: e.data };
        break;
      case "audio_error":
        yield { type: "audio_error", code: e.code };
        break;
      case "text":
        yield { type: "text", delta: e.delta };
        break;
      case "source":
        // a saree has no `target` from the API: its page is built from the source's own id (a canonical uuid, checked by the parser), never from text
        if (sources++ < MAX_SOURCES) yield { type: "source", label: e.label, href: e.target ? await pathFor(e.target, base, enquiryOfQuote) : e.kind === "catalogue_item" ? `${base}/catalogue/${e.id}` : null };
        break;
      case "draft":
        if (drafts++ < MAX_DRAFTS)
          yield { type: "draft", id: e.id, kind: e.kind, title: e.title, summary: e.summary, href: await pathFor(e.target, base, enquiryOfQuote), language: e.language, gloss: e.gloss_en, machine: e.machine_draft };
        break;
      case "error":
        yield { type: "error", code: knownCode(e.code) };
        return;
      case "done":
        yield { type: "done" };
        if (!options.voice) return;
        finished = true; // the API speaks AFTER it has said `done`: go on reading for the audio
        break;
    }
  }
  if (!finished) yield { type: "error" }; // the stream ended with neither `done` nor `error`: the answer is not known to be whole
}
