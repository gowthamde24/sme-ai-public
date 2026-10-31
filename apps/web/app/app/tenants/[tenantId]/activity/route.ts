import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readActivity } from "@/lib/activity/source";
import { activityWire } from "@/lib/activity/types";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

/**
 * GET /app/tenants/[tenantId]/activity: the "Live now" strip asks here every ten seconds or so while the tab is in front. The answer is the API's own shape, {items: [...], poll_after_s} (lib/activity/types.ts) read with the person's OWN token, which the browser never holds. Same-site
 * requests only, never cached; a rejected session is a plain 401 (a fetch cannot follow a sign-in redirect); a read that fails is 503 (the strip keeps its last line and tries again later). Nothing is written.
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
    await fetchTenant(user.accessToken, tenantId); // a member of this workspace, or a 404
    const feed = await readActivity(user.accessToken, tenantId);
    return feed === null ? new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } }) : new Response(JSON.stringify(activityWire(feed)), { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof ApiRequestError && error.status === 404) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
