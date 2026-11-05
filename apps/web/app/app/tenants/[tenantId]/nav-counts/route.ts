import { type NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { NO_COUNTS, getNavCounts } from "@/lib/api/nav-counts";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

/**
 * GET /app/tenants/[tenantId]/nav-counts (job sidebar v2): the menu asks here after the page has been drawn, at most every 30 seconds while the tab is in front and when it comes back to the front. The answer is
 * {counts} from C1's `GET /nav-counts` (docs/contracts/nav-counts.md) read with the person's OWN token (which the browser never holds). Same-site only; a rejected session is a plain 401 (a fetch cannot follow a sign-in redirect).
 * Any other failure answers "nothing known" (every number null), so the menu just draws no badges: the counts are a convenience, never a reason for an error.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return new Response(JSON.stringify({ counts: await getNavCounts(user.accessToken, tenantId) }), { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    return new Response(JSON.stringify({ counts: NO_COUNTS }), { status: 200, headers: NO_STORE });
  }
}
