import type { NextRequest } from "next/server";

import { dayOrToday, readStandupAudio } from "../ai-team-data";
import { teamRoute } from "../team-route";

export const dynamic = "force-dynamic";

/** GET …/ai-team/standup-audio?date= : the stand-up's sound (the API's WAV with the person's own token; a tone in mock mode), Owner and Admin (the API refuses the others). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return teamRoute(request, tenantId, async (ctx) => {
    const audio = await readStandupAudio(ctx, dayOrToday(request.nextUrl.searchParams.get("date")));
    const type = audio.contentType === "audio/x-wav" || audio.contentType === "audio/wave" ? "audio/wav" : audio.contentType;
    if (!/^audio\/(wav|mpeg|ogg|webm)$/.test(type)) return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
    return new Response(audio.bytes as BodyInit, { status: 200, headers: { "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
