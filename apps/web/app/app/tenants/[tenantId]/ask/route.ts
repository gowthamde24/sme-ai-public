import { type NextRequest } from "next/server";

import type { AskEvent } from "@/components/v2/app/today/ask/ask-types";
import { sendAssistantMessage } from "@/lib/api/assistant";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import { knownCode, toAskEvents, type QuoteLookup } from "./ask-stream";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;
const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const line = (e: AskEvent) => `${JSON.stringify(e)}\n`;

/** A POST from this site only. The session cookie is sent along with any request to this address, so a page on another site must not be able to make the Main agent run. */
function fromThisSite(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try {
    return origin !== null && host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * "Ask your team": the box on Today posts the person's question here; this route asks the Main agent (Job AG) with the person's OWN token, which the browser never holds, and passes the answer
 * on as one JSON event per line in the box's shape (ask-types.ts), with every `target` already turned into a path inside this workspace. Nothing is decided here: the API checks the person's
 * role, the kill switches and the daily cost cap, and the Main agent only reads and leaves drafts. A refusal arrives as one `error` event with a code the box has a sentence for.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404 });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403 });

  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 }); // requireUser redirects to sign-in; a fetch needs a plain answer
  }

  const raw = await request.text();
  let body: unknown;
  try {
    body = raw.length <= MAX_BODY ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const text = typeof b?.text === "string" ? b.text.trim() : "";
  const messageId = b?.messageId;
  const conversationId = b?.conversationId;
  if (!b || text.length < 1 || text.length > 4000 || typeof messageId !== "string" || !isCanonicalUuid(messageId) || (conversationId !== undefined && (typeof conversationId !== "string" || !isCanonicalUuid(conversationId)))) {
    return new Response("Bad request", { status: 400 });
  }

  const base = `/app/tenants/${tenantId}`;
  const enquiries = new Map<string, string | null>();
  const enquiryOfQuote: QuoteLookup = async (id) => {
    if (!enquiries.has(id)) {
      try {
        enquiries.set(id, (await fetchQuote(user.accessToken, tenantId, id)).enquiry_id);
      } catch (error) {
        if (error instanceof ApiAuthError) throw error;
        enquiries.set(id, null);
      }
    }
    return enquiries.get(id) ?? null;
  };

  const events = toAskEvents(sendAssistantMessage(user.accessToken, tenantId, { messageId, conversationId, text }), base, enquiryOfQuote);
  const iterator = events[Symbol.asyncIterator]();
  // The API refuses before it streams anything (switch off, cost cap, role): read the first event now, so a rejected session can still be a 401.
  let first: IteratorResult<AskEvent>;
  try {
    first = await iterator.next();
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401 });
    const code = error instanceof ApiRequestError ? (error.status === 403 ? "forbidden" : knownCode(error.code)) : undefined;
    return new Response(line({ type: "error", code }), { headers: NDJSON });
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
