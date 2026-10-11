import { type NextRequest } from "next/server";

import { sendAssistantMessage } from "@/lib/api/assistant";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite, ndjsonResponse } from "./ask-response";
import { knownCode, toAskEvents, type QuoteLookup } from "./ask-stream";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;

/**
 * "Ask your team": the box on Today posts the person's question here; this route asks the Agent OWL (Job AG) with the person's OWN token, which the browser never holds, and passes the answer
 * on as one JSON event per line in the box's shape (ask-types.ts), with every `target` already turned into a path inside this workspace. Nothing is decided here: the API checks the person's
 * role, the kill switches and the daily cost cap, and the Agent OWL only reads and leaves drafts. A refusal arrives as one `error` event with a code the box has a sentence for.
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
  return ndjsonResponse(events, (error) => (error instanceof ApiRequestError ? (error.status === 403 ? "forbidden" : knownCode(error.code)) : undefined));
}
