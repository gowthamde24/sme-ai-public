import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { appV4 } from "@/lib/screens/flag";

import { fromThisSite } from "../../../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/calls/[callId]/take-over-token (app v4 part 4): taking over a live call opens the API's WebSocket, which takes the person's sign-in in its FIRST message (a browser socket cannot send a header; C1 #398).
 * So, as for "Talk to your assistant" (../../voice-token), this hands the browser its access token: only while APP_V4 is on, only from this site, only for the Owner or an Admin of THAT workspace (the API checks again), never kept by
 * the browser's cache; the page's content-security-policy lets it go only to the API's socket address. A plain route, not a server action: a server action makes Next draw the page again, and the open call must not be touched.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; callId: string }> }) {
  const { tenantId, callId } = await params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!appV4() || !isCanonicalUuid(tenantId) || !isCanonicalUuid(callId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers });
  }
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return new NextResponse(null, { status: 404, headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers });
  }
  return NextResponse.json({ token: user.accessToken }, { headers });
}
