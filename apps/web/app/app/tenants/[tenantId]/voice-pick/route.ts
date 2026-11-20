import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getVoiceLiveFile, getVoiceSampleFile } from "@/lib/api/voice-picker";
import { requireUser } from "@/lib/auth/session";
import { voicePickerScreens } from "@/lib/screens/flag";
import { mockSampleWav } from "@/lib/voice-samples/mock";
import { readVoicePicker } from "@/lib/voice-picker/source";
import { VOICE_ID } from "@/lib/voice-picker/types";

export const dynamic = "force-dynamic";

const PITCHES = ["female_warm", "female_clear", "male_calm", "male_lively"] as const;

/**
 * GET /app/tenants/[tenantId]/voice-pick?id=<voice id>: the recorded sample of ONE voice of the catalogue, for the voice picker of Settings > AI assistant. Owner and Admin only. The browser asks THIS route (its person's token stays on the server and the
 * page's media rule allows only this app's own address); the id must be one the catalogue lists (a voice with no recording is spoken live, `&tone=` optional), and the file is the one the catalogue names (a path on the API): nothing else can be asked for. The sample is made once per voice, so the sound may be kept by
 * the browser for a day. VOICE_PICKER_SCREENS: off = 404, mock = a synthetic two-note sound that tells the voices apart by pitch, 1 = C1's file.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (voicePickerScreens() === "off" || !isCanonicalUuid(tenantId) || !VOICE_ID.test(id)) return new NextResponse(null, { status: 404 });
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
  const headers = { "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" };
  try {
    const read = await readVoicePicker({ token: user.accessToken, tenantId });
    if (read.mode !== "ok") return new NextResponse(null, { status: 404 });
    const index = read.data.voices.findIndex((v) => v.id === id);
    if (index < 0) return new NextResponse(null, { status: 404 });
    const voice = read.data.voices[index];
    // a voice with no recording yet (C1 `sample_ready: false`) is spoken live in its own voice and the tone asked for (`&tone=`); the answer must name that voice, else it is not played as this one (an older API speaks the voice in force)
    if (!read.data.fake && (!voice.sampleReady || voice.sampleUrl === null)) {
      const tone = request.nextUrl.searchParams.get("tone");
      const live = await getVoiceLiveFile(user.accessToken, tenantId, voice.language, voice.id, tone === "friendly" || tone === "respectful" || tone === "quick" ? tone : null);
      if (!live || live.voiceId !== voice.id) return new NextResponse(null, { status: 404 });
      return new NextResponse(live.bytes, { status: 200, headers: { ...headers, "Cache-Control": "private, max-age=600", "Content-Type": live.contentType.split(";")[0] } });
    }
    if (read.data.fake) return new NextResponse(mockSampleWav({ voice: PITCHES[index % PITCHES.length], lang: "en", tone: "warm", name: "" }) as BodyInit, { status: 200, headers: { ...headers, "Content-Type": "audio/wav" } });
    const got = await getVoiceSampleFile(user.accessToken, voice.sampleUrl as string);
    if (!/^audio\/(mpeg|wav|x-wav|ogg|mp4|webm)(;|$)/.test(got.contentType)) return new NextResponse(null, { status: 404 });
    return new NextResponse(got.bytes, { status: 200, headers: { ...headers, "Content-Type": got.contentType.split(";")[0] } });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiRequestError && (error.status === 404 || error.status === 422) ? 404 : error instanceof ApiRequestError && error.status === 429 ? 429 : 502 });
  }
}
