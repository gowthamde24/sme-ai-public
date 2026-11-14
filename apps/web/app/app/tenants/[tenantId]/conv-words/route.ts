import { NextResponse, type NextRequest } from "next/server";

import { wordsFor } from "@/i18n/app-words";
import { LANGS, type Lang } from "@/i18n/lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { CONV_WORD_SETS, isConvSet } from "@/lib/conversation/word-sets";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * GET /app/tenants/[tenantId]/conv-words?lang=te&set=talk|task: the words of ONE conversation part in ONE language (owner, 14 Nov 2026: the language of the conversation decides the words of the plan card, its buttons, the status lines and the errors; the app's menus keep the app language).
 * The page carries the app language only; the other languages come here when the person picks one in the composer (and are asked for ahead of time), so no page grows by three languages. Only the four languages with a review sheet; only the two closed sets; only for a signed-in member of THAT
 * workspace, from this site. The answer is plain dictionary text (nothing about the business or the person).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const headers = { "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" };
  const lang = request.nextUrl.searchParams.get("lang");
  const set = request.nextUrl.searchParams.get("set");
  if (!isCanonicalUuid(tenantId) || !fromThisSite(request) || !(LANGS as readonly string[]).includes(lang ?? "") || !isConvSet(set)) return new NextResponse(null, { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers: { ...headers, "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ words: wordsFor(lang as Lang, CONV_WORD_SETS[set]) }, { headers });
}
