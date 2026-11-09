import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { listLiveCalls } from "@/lib/api/calls";
import { fetchLead, isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { liveWire, sourceKeyOf, type LiveCall, type SourceKey } from "@/lib/live-calls/model";
import { callerNamed } from "@/lib/calls/view";
import { appV4 } from "@/lib/screens/flag";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;
const plain = (status: number, text: string) => new Response(text, { status, headers: { "Cache-Control": "no-store" } });

/** A lead's source rarely changes: one read per lead for ten minutes, not one per poll (the bar asks every 5 seconds). Kept per server; a lost entry is only one more read. */
const SOURCE_TTL_MS = 600_000;
const sources = new Map<string, { at: number; key: SourceKey | null }>();
async function sourceOf(token: string, tenantId: string, leadId: string | null): Promise<SourceKey | null> {
  if (!leadId) return null;
  const k = `${tenantId}:${leadId}`;
  const hit = sources.get(k);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.key;
  let key: SourceKey | null = null;
  try {
    key = sourceKeyOf((await fetchLead(token, tenantId, leadId)).source);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null; // no source is shown rather than a wrong one; not remembered, so it is tried again
  }
  if (sources.size > 500) sources.clear();
  sources.set(k, { at: Date.now(), key });
  return key;
}

/**
 * GET /app/tenants/[tenantId]/live-calls (app v4, the live-call bar): the calls that are live now, from C1's `GET /calls?state=live`, with each one's lead source and whether the person may take it over. Only while APP_V4 is on, only from
 * this site, only for the Owner, Admin and Sales (a Viewer has no calls: 404, and the bar stops asking). Never cached; a rejected session is 401; a read that fails is 503 (the bar keeps what it had). No phone number, no summary, no
 * transcript: the contact's name (the API's `who`), the clock and the source.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!appV4() || !isCanonicalUuid(tenantId)) return plain(404, "Not found");
  if (!fromThisSite(request)) return plain(403, "Forbidden");
  let user;
  try {
    user = await requireUser();
  } catch {
    return plain(401, "Unauthorized");
  }
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin" && role !== "sales") return plain(404, "Not found");
    const page = await listLiveCalls(user.accessToken, tenantId);
    const live = page.items.filter((c) => c.live).slice(0, 5);
    const calls: LiveCall[] = await Promise.all(
      live.map(async (c) => ({
        id: c.id,
        who: c.who,
        named: callerNamed(c.who),
        elapsedS: c.elapsedS,
        answered: c.state === "in_progress",
        source: await sourceOf(user.accessToken, tenantId, c.leadId),
        canTakeOver: (role === "owner" || role === "admin") && c.state === "in_progress" && c.canTakeOver, // (only where the API says it works for this call)
      })),
    );
    return new Response(JSON.stringify(liveWire({ calls, pollAfterS: page.pollAfterS })), { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return plain(401, "Unauthorized");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) return plain(404, "Not found");
    return plain(503, "Unavailable");
  }
}
