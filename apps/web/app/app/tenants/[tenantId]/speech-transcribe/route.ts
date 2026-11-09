import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { SPEECH_LANGUAGES, transcribeSpeech, type SpeechLanguage } from "@/lib/api/speech";
import { requireUser } from "@/lib/auth/session";
import { appV4 } from "@/lib/screens/flag";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

/** One recording is 30 s and 1.5 MB at the API; a little more is allowed here so the API's own refusal ("too long") is the one the person reads. */
const MAX_BYTES = 2_000_000;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const isBlob = (v: unknown): v is Blob => typeof v === "object" && v !== null && typeof (v as Blob).size === "number" && typeof (v as Blob).arrayBuffer === "function";
const refuse = (status: number, code: string, message: string, retryAfter: number | null = null) => NextResponse.json({ error: { code, message, retry_after: retryAfter } }, { status, headers });

/**
 * POST /app/tenants/[tenantId]/speech-transcribe (app v4, typing by voice): the browser sends its recording here (the browser never calls the API with a token of its own) and this passes it to C1's `POST /speech/transcribe` with the person's
 * session. Only while APP_V4 is on, only from this site, only for the Owner, Admin and Sales. The recording is held in memory for this request and never stored; the words are never logged. The answer is `{text, language}` or the API's own
 * refusal as `{error: {code, message, retry_after}}` (the status is the API's: 422 too_long / empty, 429 cap_reached, 415 unsupported, 503 unavailable, 504 timeout).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!appV4() || !isCanonicalUuid(tenantId)) return new NextResponse(null, { status: 404, headers });
  if (!fromThisSite(request)) return new NextResponse(null, { status: 403, headers });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(415, "unsupported", "That is not a recording.");
  }
  const audio = form.get("audio");
  const language = form.get("language");
  if (!isBlob(audio) || audio.size === 0) return refuse(422, "empty", "Nothing was recorded.");
  if (audio.size > MAX_BYTES) return refuse(422, "too_long", "That recording is too long.");
  if (typeof language !== "string" || !(SPEECH_LANGUAGES as readonly string[]).includes(language)) return refuse(415, "unsupported", "That language is not available.");
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin" && role !== "sales") return new NextResponse(null, { status: 404, headers });
    const out = await transcribeSpeech(user.accessToken, tenantId, audio, language as SpeechLanguage);
    return NextResponse.json(out, { headers });
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers });
    if (error instanceof ApiRequestError) return refuse(error.status >= 400 && error.status < 600 ? error.status : 502, error.code, error.message, error.retryAfter ?? null);
    return refuse(502, "unavailable", "Typing by voice is not available right now.");
  }
}
