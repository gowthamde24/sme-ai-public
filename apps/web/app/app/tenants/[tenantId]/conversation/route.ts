import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { askConsentForPlan, askErrorOf } from "@/lib/api/ask-consent";
import { isCanonicalUuid } from "@/lib/api/crm";
import { approveSearch, cancelSearch } from "@/lib/api/lead-finder";
import { archiveConversation, confirmAction, getHistory, listConversations } from "@/lib/api/turns";
import { requireUser } from "@/lib/auth/session";
import { browserVoice } from "@/lib/screens/flag";
import { readEntitlements } from "@/lib/plan/tier-source";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/conversation: the conversation panel's side calls, one JSON request each, always this person's own token (it stays here), only where the panel is on (BROWSER_VOICE) and only from this site:
 *   {op: "list", before?}            the person's own conversations (newest first)
 *   {op: "open", id}                 the messages of one
 *   {op: "archive", id}              hides it (nothing is deleted)
 *   {op: "confirm", actionId, decision: "yes" | "no", secondConfirm?: true}  (secondConfirm: the answer to the second question of a big plan; a plain yes to one is refused with the closed word "second")   the owner's answer to a plan (the Owner only; the API checks again)
 *   {op: "lf_approve" | "lf_cancel", searchId}          the Lead Finder card's OK (the search runs; the answer is the result card) or Cancel (Owner, Admin; the API checks again)
 * A plain route, not a server action: a server action makes Next draw the page again under the open panel.
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
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.text();
    const json: unknown = raw.length <= 2000 ? JSON.parse(raw) : null;
    body = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return new NextResponse(null, { status: 400, headers });
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers });
  }
  if (role !== "owner" && role !== "admin" && role !== "sales") return new NextResponse(null, { status: 404, headers });
  const id = body.id;
  try {
    switch (body.op) {
      case "list":
        return NextResponse.json(await listConversations(user.accessToken, tenantId, typeof body.before === "string" ? body.before : undefined), { headers });
      case "open":
        if (typeof id !== "string" || !isCanonicalUuid(id)) return new NextResponse(null, { status: 400, headers });
        return NextResponse.json({ id, messages: await getHistory(user.accessToken, tenantId, id) }, { headers });
      case "archive":
        if (typeof id !== "string" || !isCanonicalUuid(id)) return new NextResponse(null, { status: 400, headers });
        await archiveConversation(user.accessToken, tenantId, id);
        return NextResponse.json({ ok: true }, { headers });
      case "confirm": {
        if (role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { headers });
        const actionId = body.actionId;
        if (typeof actionId !== "string" || !isCanonicalUuid(actionId) || (body.decision !== "yes" && body.decision !== "no")) return new NextResponse(null, { status: 400, headers });
        try {
          return NextResponse.json({ ok: true, status: (await confirmAction(user.accessToken, tenantId, actionId, body.decision, body.secondConfirm === true)).status }, { headers });
        } catch (error) {
          if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers });
          const code = error instanceof ApiRequestError ? error.code : "";
          // closed words the panel has a sentence for (the API's own English is never passed on)
          return NextResponse.json({ ok: false, error: code === "second_yes_required" ? "second" : code === "daily_cap_exceeded" ? "cap" : code === "mfa_required" ? "mfa" : code === "action_expired" ? "expired" : code === "action_state" ? "state" : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "down" }, { headers });
        }
      }
      case "ask_consent": {
        // the Owner asks the people a waiting plan left out (a WhatsApp "reply OK") or confirms they agreed (a NEW plan card comes back); the API's words are never passed on, only numbers and closed codes
        if (role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { headers });
        const actionId = body.actionId;
        if (typeof actionId !== "string" || !isCanonicalUuid(actionId) || (body.how !== "whatsapp" && body.how !== "owner_confirms")) return new NextResponse(null, { status: 400, headers });
        try {
          return NextResponse.json({ ok: true, result: await askConsentForPlan(user.accessToken, tenantId, actionId, body.how) }, { headers });
        } catch (error) {
          if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers });
          return NextResponse.json({ ok: false, error: askErrorOf(error) }, { headers });
        }
      }
      case "lf_approve":
      case "lf_cancel": {
        if (role !== "owner" && role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { headers });
        const searchId = body.searchId;
        if (typeof searchId !== "string" || !isCanonicalUuid(searchId)) return new NextResponse(null, { status: 400, headers });
        // a Lead Desk plan (owner decision 4 Nov) has no Lead Finder: no search runs from the chat, whatever the API would say
        if (!(await readEntitlements(user.accessToken, tenantId)).features.leadFinder) return NextResponse.json({ ok: false, error: "plan" }, { headers });
        try {
          const search = await (body.op === "lf_approve" ? approveSearch : cancelSearch)(user.accessToken, tenantId, searchId);
          return NextResponse.json({ ok: true, search }, { headers });
        } catch (error) {
          if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers });
          const code = error instanceof ApiRequestError ? error.code : "";
          // closed words the card has a sentence for (the API's own English is never passed on)
          const word = code === "search_cap_reached" ? "cap" : code === "prospect_state" ? "state" : code === "not_in_plan" ? "plan" : code === "lead_finder_off" || code === "lead_finder_not_available" ? "off" : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "down";
          return NextResponse.json({ ok: false, error: word }, { headers });
        }
      }
      default:
        return new NextResponse(null, { status: 400, headers });
    }
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 502, headers });
  }
}
