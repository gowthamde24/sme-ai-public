import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { browserVoice } from "@/lib/screens/flag";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/voice-token: "Talk to your assistant" (job DV). The API's WebSocket takes the person's sign-in in its FIRST MESSAGE (a browser socket cannot send a header; contract-browser-voice.md), so this is the one place the app hands the
 * browser its access token: only where BROWSER_VOICE is on, only from this site, only for a person who may use it (Owner, Admin or Sales of THAT workspace: the API checks again and closes with 4403 for anyone else), never kept by the browser's cache, and the
 * page's content-security-policy lets it be sent only to the API's socket address. A plain route, not a server action: a server action makes Next draw the page again, and the open voice chat must not be touched by that.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!browserVoice() || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers });
  }
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin" && role !== "sales") return new NextResponse(null, { status: 404, headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers });
  }
  return NextResponse.json({ token: user.accessToken }, { headers });
}
