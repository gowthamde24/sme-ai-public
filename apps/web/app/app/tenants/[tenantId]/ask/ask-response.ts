import type { NextRequest } from "next/server";

import type { AskEvent } from "@/components/v2/app/today/ask/ask-types";
import { ApiAuthError } from "@/lib/api/client";

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const line = (e: AskEvent) => `${JSON.stringify(e)}\n`;

/** A POST from this site only. The session cookie is sent along with any request to this address, so a page on another site must not be able to make the Agent OWL run. */
export function fromThisSite(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try {
    return origin !== null && host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** One refusal as the box's last word: an `error` event with a code the box has a sentence for (or none: the general sentence). */
export const refusalResponse = (code?: string): Response => new Response(line({ type: "error", code }), { headers: NDJSON });

/**
 * The box's events as one JSON event per line. The API refuses before it streams anything (switch off, cost cap, role, a bad recording): the first event is read now, so a rejected session can still be
 * a 401 and a refusal is one `error` event whose code `codeOf` chooses. After that a broken stream ends with a general `error` event, so the browser always gets a last word.
 */
export async function ndjsonResponse(events: AsyncGenerator<AskEvent>, codeOf: (error: unknown) => string | undefined): Promise<Response> {
  const iterator = events[Symbol.asyncIterator]();
  let first: IteratorResult<AskEvent>;
  try {
    first = await iterator.next();
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401 });
    return refusalResponse(codeOf(error));
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let step = first;
        while (!step.done && !cancelled) {
          controller.enqueue(encoder.encode(line(step.value)));
          step = await iterator.next();
        }
      } catch {
        if (!cancelled) controller.enqueue(encoder.encode(line({ type: "error" }))); // a broken stream or an answer that breaks the contract: the general sentence
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      void iterator.return?.(undefined);
    },
  });
  return new Response(stream, { headers: NDJSON });
}
