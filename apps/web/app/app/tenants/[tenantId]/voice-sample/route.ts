import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getVoicePreview, getVoicePreviewText } from "@/lib/api/voice-samples";
import { savedGreetingText } from "@/lib/api/opening-line";
import { getVoicesPreviewFile } from "@/lib/api/voice-picker";
import { voicePickerScreens } from "@/lib/screens/flag";
import { requireUser } from "@/lib/auth/session";
import { voiceSampleScreens } from "@/lib/screens/flag";
import { mockSampleWav } from "@/lib/voice-samples/mock";
import { readSampleQuery } from "@/lib/voice-samples/types";

export const dynamic = "force-dynamic";

/**
 * GET /app/tenants/[tenantId]/voice-sample?voice=&lang=&tone=&name= (job DQ part 3, now the live PREVIEW of job DT): the opening line with the workspace's real assistant and business names and one reply, for the voice picker of Settings > AI assistant; with `&text=1`, the same words as JSON to show beside the player. Owner and Admin only. The browser asks THIS route (its person's token stays on the
 * server); the query is closed words and the assistant's name; the answer is a sound and nothing else. VOICE_SAMPLE_SCREENS: off = 404, mock = a synthetic two-note sound that tells the voices apart by pitch, 1 = C1's preview through the API (never the fixed sample files); with VOICE_PICKER_SCREENS=1 the sound is the preview of the CHOSEN catalogue voice (`/voices/preview`).
 * The sound is private to the person and never kept by the browser.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const mode = voiceSampleScreens();
  const query = readSampleQuery(request.nextUrl.searchParams);
  if (mode === "off" || !isCanonicalUuid(tenantId) || query === null) return new NextResponse(null, { status: 404 });
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
  // the preview speaks the business's CURRENT name, so the browser never keeps one
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (request.nextUrl.searchParams.get("text") === "1") {
    if (mode === "mock") return new NextResponse(null, { status: 404 });
    try {
      // with the voice catalogue on, the sound is the saved opening line: its words are that line's exact greeting
      if (voicePickerScreens() === "on") {
        const text = await savedGreetingText(user.accessToken, tenantId, query.lang);
        return text ? NextResponse.json({ text }, { status: 200, headers }) : new NextResponse(null, { status: 404 });
      }
      const said = await getVoicePreviewText(user.accessToken, tenantId, query);
      return said ? NextResponse.json({ text: said.text }, { status: 200, headers }) : new NextResponse(null, { status: 404 });
    } catch {
      return new NextResponse(null, { status: 502 });
    }
  }
  if (mode === "mock") return new NextResponse(mockSampleWav(query) as BodyInit, { status: 200, headers: { ...headers, "Content-Type": "audio/wav" } });
  try {
    // with the voice catalogue on there is ONE preview: the saved opening line in the voice the workspace chose (the old four-persona sample is not used)
    const got = voicePickerScreens() === "on" ? await getVoicesPreviewFile(user.accessToken, tenantId, query.lang) : await getVoicePreview(user.accessToken, tenantId, query);
    if (!got) return new NextResponse(null, { status: 404 });
    return new NextResponse(got.bytes, { status: 200, headers: { ...headers, "Content-Type": got.contentType.split(";")[0], ...("voiceId" in got && typeof got.voiceId === "string" ? { "X-Voice-Id": got.voiceId } : {}) } });
  } catch (error) {
    // C1: six samples a minute and a daily cap per workspace (429 + Retry-After); the page says the sample could not be played
    if (error instanceof ApiRequestError && error.status === 429) return new NextResponse(null, { status: 429, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {} });
    return new NextResponse(null, { status: 502 });
  }
}
