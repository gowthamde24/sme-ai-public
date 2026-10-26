import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getVoiceSample } from "@/lib/api/voice-samples";
import { requireUser } from "@/lib/auth/session";
import { voiceSampleScreens } from "@/lib/screens/flag";
import { mockSampleWav } from "@/lib/voice-samples/mock";
import { readSampleQuery } from "@/lib/voice-samples/types";

export const dynamic = "force-dynamic";

/**
 * GET /app/tenants/[tenantId]/voice-sample?voice=&lang=&tone=&name= (job DQ part 3): one short voice sample for the voice picker of Settings > AI assistant. Owner and Admin only. The browser asks THIS route (its person's token stays on the
 * server); the query is closed words and the assistant's name; the answer is a sound and nothing else. VOICE_SAMPLE_SCREENS: off = 404, mock = a synthetic two-note sound that tells the voices apart by pitch, 1 = C1's sample through the API.
 * The sound is private to the person and may be kept by the browser for an hour (the same query is the same sound).
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
  const headers = { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
  if (mode === "mock") return new NextResponse(mockSampleWav(query) as BodyInit, { status: 200, headers: { ...headers, "Content-Type": "audio/wav" } });
  try {
    const got = await getVoiceSample(user.accessToken, tenantId, query);
    if (!got) return new NextResponse(null, { status: 404 });
    return new NextResponse(got.bytes, { status: 200, headers: { ...headers, "Content-Type": got.contentType.split(";")[0] } });
  } catch (error) {
    // C1: six samples a minute and a daily cap per workspace (429 + Retry-After); the page says the sample could not be played
    if (error instanceof ApiRequestError && error.status === 429) return new NextResponse(null, { status: 429, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {} });
    return new NextResponse(null, { status: 502 });
  }
}
