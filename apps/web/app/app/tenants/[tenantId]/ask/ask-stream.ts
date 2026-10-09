import { ERROR_CODES, type AskEvent } from "@/components/v2/app/today/ask/ask-types";
import type { AssistantEvent, Target } from "@/lib/api/assistant";

/** What one answer may carry to the browser. The box keeps the same limits; keeping them here too bounds the lookups a single answer can cause. */
export const MAX_SOURCES = 8;
export const MAX_DRAFTS = 5;

/** The enquiry a quote belongs to (a quote has no page of its own), or null when it cannot be read. */
export type QuoteLookup = (quoteId: string) => Promise<string | null>;

/**
 * The page of THIS workspace that a `target` ({type, id} from the Main agent) opens. The path is built here from a type the API cannot invent (the parser accepts only these four) and
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
  }
}

/** A code the box has a fixed sentence for, or nothing: the API's own sentence is English and is never passed on. */
export function knownCode(code: string): string | undefined {
  return (ERROR_CODES as readonly string[]).includes(code) ? code : undefined;
}

/**
 * The Main agent's events (Job AG) as the Ask box's events: a `target` becomes a path inside the workspace, the fields the box does not draw (`status`, `kind` of a source, the chat's ids)
 * are dropped, the number of sources and drafts is capped, and an error keeps only its code if the box knows it. Anything thrown while reading the stream ends the answer with an error event,
 * so the browser always gets a last word and never a half-open answer.
 */
export async function* toAskEvents(events: AsyncIterable<AssistantEvent>, base: string, enquiryOfQuote: QuoteLookup): AsyncGenerator<AskEvent> {
  let sources = 0;
  let drafts = 0;
  for await (const e of events) {
    switch (e.type) {
      case "text":
        yield { type: "text", delta: e.delta };
        break;
      case "source":
        if (sources++ < MAX_SOURCES) yield { type: "source", label: e.label, href: await pathFor(e.target, base, enquiryOfQuote) };
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
        return;
    }
  }
  yield { type: "error" }; // the stream ended with neither `done` nor `error`: the answer is not known to be whole
}
