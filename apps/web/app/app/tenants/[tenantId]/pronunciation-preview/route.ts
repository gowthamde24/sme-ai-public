import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { speakSoundsLike } from "@/lib/api/pronunciation";
import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { requireUser } from "@/lib/auth/session";
import { cleanText, SOUND_MAX } from "@/lib/pronunciation/types";
import { pronunciationScreens } from "@/lib/screens/flag";
import { mockSampleWav } from "@/lib/voice-samples/mock";

export const dynamic = "force-dynamic";

/**
 * GET /app/tenants/[tenantId]/pronunciation-preview?lang=&say=: the sound of the "sounds like" text in the voice the workspace chose for that language ("Hear it" beside an entry). Owner and Admin only; the sound is private and never kept. mock = a two-note tone (it says
 * the screen works, not how the word sounds), 1 = C1's preview through the API.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const mode = pronunciationScreens();
  const lang = request.nextUrl.searchParams.get("lang");
  const say = cleanText(request.nextUrl.searchParams.get("say"), SOUND_MAX);
  if (mode === "off" || !isCanonicalUuid(tenantId) || say === null || !(CALL_LANGS as readonly unknown[]).includes(lang)) return new NextResponse(null, { status: 404 });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return new NextResponse(null, { status: 404 });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404 });
  }
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (mode === "mock") return new NextResponse(mockSampleWav({ voice: "female_warm", lang: lang as CallLang, tone: "warm", name: "" }) as BodyInit, { status: 200, headers: { ...headers, "Content-Type": "audio/wav" } });
  try {
    const got = await speakSoundsLike(user.accessToken, tenantId, lang as CallLang, say);
    if (!got) return new NextResponse(null, { status: 404 });
    return new NextResponse(got.bytes as BodyInit, { status: 200, headers: { ...headers, "Content-Type": got.contentType } });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 429) return new NextResponse(null, { status: 429, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {} });
    return new NextResponse(null, { status: 502 });
  }
}
