import { type NextRequest } from "next/server";

import { ASSISTANT_LANGUAGES, type AssistantLanguage } from "@/lib/api/assistant";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchQuote } from "@/lib/api/quotes";
import { MAX_RECORDING_BYTES, probeVoice, sendVoiceMessage } from "@/lib/api/voice";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite, ndjsonResponse, refusalResponse } from "../ask-response";
import { toAskEvents, voiceErrorCode, type QuoteLookup } from "../ask-stream";

export const dynamic = "force-dynamic";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const RECORDING_TYPE = /^audio\/(webm|ogg|mp4|x-m4a|m4a|mpeg|mp3|wav|x-wav|flac)(;.*)?$/i;

async function signedIn() {
  try {
    return await requireUser();
  } catch {
    return null; // requireUser redirects to sign-in; a fetch needs a plain answer
  }
}

/**
 * Is voice on for this person? (job BF) The Ask box asks once when it appears and draws a microphone only when the answer is yes: no dead button. The API has no separate "capabilities" answer, so
 * `probeVoice` asks the voice route itself with an empty recording, which it refuses before it hears or charges anything. `{ available, speech }`: `speech` is whether a spoken answer can be asked for.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404 });
  const user = await signedIn();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try {
    return new Response(JSON.stringify(await probeVoice(user.accessToken, tenantId)), { headers: JSON_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401 });
    return new Response(JSON.stringify({ available: false, speech: false }), { headers: JSON_HEADERS });
  }
}

/**
 * "Ask your team" by voice: the box posts the RECORDING here as it is (the body), with `?messageId=&conversationId=&lang=&speak=`; this route sends it to the Agent OWL's voice route with the person's OWN
 * token (the browser never holds it) and passes the answer on in the box's shape, one JSON event per line: `heard` (what the recording was understood as), the written answer, and `audio` (the spoken
 * answer) when it was asked for. The recording is read into memory for this request and forgotten; it is not stored or logged here. A refusal arrives as one `error` event with a code the box has a sentence for.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404 });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403 });
  const user = await signedIn();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const q = request.nextUrl.searchParams;
  const messageId = q.get("messageId");
  const conversationId = q.get("conversationId");
  const lang = q.get("lang");
  const contentType = request.headers.get("content-type") ?? "";
  if (!messageId || !isCanonicalUuid(messageId) || (conversationId !== null && !isCanonicalUuid(conversationId)) || (lang !== null && !(ASSISTANT_LANGUAGES as readonly string[]).includes(lang)) || !RECORDING_TYPE.test(contentType)) {
    return new Response("Bad request", { status: 400 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_RECORDING_BYTES) return refusalResponse("voice_too_long"); // a bigger file than a minute of speech can be
  const audio = await request.arrayBuffer();
  if (audio.byteLength > MAX_RECORDING_BYTES) return refusalResponse("voice_too_long");
  if (audio.byteLength < 1) return refusalResponse("voice_too_short");

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

  const events = toAskEvents(
    sendVoiceMessage(user.accessToken, tenantId, {
      messageId,
      conversationId: conversationId ?? undefined,
      language: (lang ?? undefined) as AssistantLanguage | undefined,
      speak: q.get("speak") === "1",
      audio,
      contentType,
    }),
    base,
    enquiryOfQuote,
    { voice: true },
  );
  return ndjsonResponse(events, (error) => (error instanceof ApiRequestError ? voiceErrorCode(error) : undefined));
}
