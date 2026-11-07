import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { appV4, talkTrainingScreens } from "@/lib/screens/flag";

import { fromThisSite } from "../../../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/ai-team/training/practice-token (app v4 part 4): a practice call by voice opens the Live talk socket in `practice_call` mode (C1 #402), whose FIRST message carries the person's sign-in (a browser socket
 * cannot send a header). As for "Talk to your assistant" (../../../voice-token): only while APP_V4 and the training page are on, only from this site, only for the Owner or an Admin (the API checks again: 4403), never cached.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!appV4() || !talkTrainingScreens() || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers });
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
