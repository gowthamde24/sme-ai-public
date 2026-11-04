import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { decidePlan, runSetupTest, saveAssistantSecret, undoAssistantAction, undoPlan } from "@/lib/api/assistant-work";
import { LIVE_TESTS, type LiveTest } from "@/lib/assistant-work/types";
import { requireUser } from "@/lib/auth/session";
import { assistantWorkScreens } from "@/lib/screens/flag";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** The API's refusal as a closed word the card has a sentence for (the API's own English is never passed on). */
function word(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.code === "mfa_required") return "mfa";
  if (error.code === "plan_expired" || error.code === "undo_expired") return "expired";
  if (error.code === "plan_state") return "state";
  if (error.code === "secret_rejected" || error.status === 422) return "rejected";
  return error.status === 403 ? "forbidden" : "down";
}

/**
 * POST /app/tenants/[tenantId]/assistant-work: the side calls of the chat's work cards and of Settings > Activity, one JSON request each, with this person's own token (it stays here), only while
 * ASSISTANT_WORK_SCREENS is `1` (in `mock` the browser answers itself: nothing reaches this route) and only from this site. ASSUMED until docs/contracts/assistant-tools.md (lib/api/assistant-work.ts):
 *   {op: "decide", planId, decision: "do" | "cancel", confirmed}     a plan's Do it / Cancel (a sensitive plan needs `confirmed`; the API checks the role and the second step again)
 *   {op: "undo", planId}                                             "Done · Undo"
 *   {op: "secret", requestId, value}                                 the secure box: the value goes ONLY into that API call; it is never logged, never answered back, never stored here
 *   {op: "test", setupId, test}                                      a guided setup's live test
 *   {op: "undo_action", actionId}                                    Settings > Activity's Undo
 * A plain route, not a server action: a server action makes Next draw the page again under the open chat (and would keep the value in its own request log in development).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (assistantWorkScreens() !== "on" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers: HEADERS });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers: HEADERS });
  }
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.text();
    const json: unknown = raw.length <= 6000 ? JSON.parse(raw) : null;
    body = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return new NextResponse(null, { status: 400, headers: HEADERS });
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers: HEADERS });
  }
  if (role === "viewer") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
  const ok = (v: Record<string, unknown>) => NextResponse.json({ ok: true, ...v }, { headers: HEADERS });
  const id = (k: string): string | null => (typeof body[k] === "string" && isCanonicalUuid(body[k] as string) ? (body[k] as string) : null);
  try {
    switch (body.op) {
      case "decide": {
        const planId = id("planId");
        if (!planId || (body.decision !== "do" && body.decision !== "cancel")) return new NextResponse(null, { status: 400, headers: HEADERS });
        return ok({ plan: await decidePlan(user.accessToken, tenantId, planId, body.decision, body.confirmed === true) });
      }
      case "undo": {
        const planId = id("planId");
        if (!planId) return new NextResponse(null, { status: 400, headers: HEADERS });
        return ok({ plan: await undoPlan(user.accessToken, tenantId, planId) });
      }
      case "secret": {
        const requestId = id("requestId");
        const value = typeof body.value === "string" ? body.value : "";
        if (!requestId || value.trim() === "" || value.length > 4000) return new NextResponse(null, { status: 400, headers: HEADERS });
        if (role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
        return ok({ last4: (await saveAssistantSecret(user.accessToken, tenantId, requestId, value)).last4 });
      }
      case "test": {
        const setupId = id("setupId");
        if (!setupId || !(LIVE_TESTS as readonly unknown[]).includes(body.test)) return new NextResponse(null, { status: 400, headers: HEADERS });
        return ok({ result: await runSetupTest(user.accessToken, tenantId, setupId, body.test as LiveTest) });
      }
      case "undo_action": {
        const actionId = id("actionId");
        if (!actionId) return new NextResponse(null, { status: 400, headers: HEADERS });
        return ok({ entry: await undoAssistantAction(user.accessToken, tenantId, actionId) });
      }
      default:
        return new NextResponse(null, { status: 400, headers: HEADERS });
    }
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers: HEADERS });
    return NextResponse.json({ ok: false, error: word(error) }, { headers: HEADERS }); // never the error itself: for the secret op it could echo the request
  }
}
