import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { removePronunciation, savePronunciation } from "@/lib/pronunciation/source";
import { pronunciationScreens } from "@/lib/screens/flag";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/pronunciation: `{ action: "save", word, sounds_like, language }` or `{ action: "delete", id }`, for the Pronunciation list of Settings and the "Mispronounced?" action of the chat. A plain route (not a server action): the chat is an open
 * overlay and a server action would make Next draw the page again under it. Owner and Admin only. The answer is the closed shape of lib/pronunciation/source.ts; the API's own English is never passed on.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (pronunciationScreens() === "off" || !isCanonicalUuid(tenantId)) return new NextResponse(null, { status: 404 });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    const ctx = { token: user.accessToken, tenantId };
    const out = b.action === "delete" ? await removePronunciation(ctx, b.id) : b.action === "save" ? await savePronunciation(ctx, b.word, b.sounds_like, b.language) : ({ ok: false, error: "invalid" } as const);
    return NextResponse.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "down" }, { status: error instanceof ApiAuthError ? 401 : 200 });
  }
}
