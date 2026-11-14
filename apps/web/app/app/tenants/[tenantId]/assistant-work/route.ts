import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { postUndoTalkPrefs } from "@/lib/api/talk-prefs";
import { cancelImport, confirmImport, decidePlan, getImport, patchImportRows, readMessageProgress, setImportDestination, unsendOutboxMessage, runSetupTest, saveAssistantSecret, undoAssistantAction, undoPlan } from "@/lib/api/assistant-work";
import { CONSENT_SOURCES, IMPORT_DESTINATIONS, LIVE_TESTS, importDraftToWire, planToWire, type ConsentSource, type ImportCounts, type LiveTest } from "@/lib/assistant-work/types";
import { requireUser } from "@/lib/auth/session";
import { assistantWorkScreens } from "@/lib/screens/flag";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/**
 * The API's refusal as a closed word the card has a sentence for (the API's own English is never passed on). The contract's codes: 403 `mfa_required` and forbidden; 409 `plan_expired`, `plan_state`,
 * `confirm_needed` (a sensitive plan without its second tap: the card asks again) and `nothing_to_undo`.
 */
function word(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.code === "mfa_required") return "mfa";
  if (error.code === "plan_expired" || error.code === "undo_expired") return "expired";
  if (error.code === "plan_state" || error.code === "confirm_needed" || error.code === "nothing_to_undo") return "state";
  if (error.code === "secret_rejected" || error.status === 422) return "rejected";
  return error.status === 403 ? "forbidden" : "down";
}

const countsToWire = (c: ImportCounts) => ({ rows: c.rows, new: c.new, existing: c.existing, invalid_phone: c.invalidPhone, unsure: c.unsure });

/** The editable import's refusals (contract file-import.md section 4): 404 gone, 409 `import_state`, 422 `consent_source_required`, 422 `validation_error` (a bad edit), 403 forbidden. */
function importWord(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.status === 404) return "gone";
  if (error.code === "import_state" || error.status === 409) return "state";
  if (error.code === "consent_source_required") return "consent";
  if (error.code === "not_yet") return "not_yet"; // new catalogue items from a file: "choose Prices" (our own sentence, never the API's)
  if (error.code === "nothing_to_add") return "nothing";
  if (error.code === "real_data_not_open") return "real_data"; // a workspace still on example data takes no real phone numbers (C1, 14 Nov)
  if (error.status === 422) return "invalid";
  return error.status === 403 ? "forbidden" : "down";
}

/**
 * The secure box's refusals (C1, 5 Nov): 422 `secret_invalid` = "check it and try again" (the value is never echoed); a request already used (409 `secret_request_used`), run out (410 `secret_request_expired`), not this Owner's (404) or not
 * saved (503 `secret_not_saved` / `secrets_unavailable`) cannot take the value again: `renew`, the card says "ask me again for a new card".
 */
const RENEW = ["secret_request_used", "secret_request_expired", "secret_not_saved", "secrets_unavailable"];
function secretWord(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.status === 422) return "rejected";
  if (RENEW.includes(error.code) || error.status === 404 || error.status === 409 || error.status === 410) return "renew";
  return word(error);
}

/**
 * POST /app/tenants/[tenantId]/assistant-work: the side calls of the chat's work cards and of Settings > Activity, one JSON request each, with this person's own token (it stays here), only while
 * ASSISTANT_WORK_SCREENS is `1` (in `mock` the browser answers itself: nothing reaches this route) and only from this site. C1's contract, docs/contracts/assistant-tools.md (lib/api/assistant-work.ts):
 *   {op: "decide", planId, decision: "do" | "cancel", confirmed}     a plan's Do it / Cancel (a sensitive plan needs `confirmed`; the API checks the role and the second step again)
 *   {op: "undo", planId}                                             "Done · Undo"
 *   {op: "secret", requestId, value}                                 the secure box: the value goes ONLY into that API call; it is never logged, never answered back, never stored here
 *   {op: "test", setupId, test}                                      a guided setup's live test
 *   {op: "undo_action", actionId}                                    Settings > Activity's Undo
 *   {op: "undo_talk_prefs", token}                                   the Undo of a "How it talks to you" card (the person's own choices)
 *   {op: "import_get" | "import_edit" | "import_confirm" | "import_cancel", importId, ...}   the editable preview of a file (docs/contracts/file-import.md)
 *   {op: "message_undo" | "message_status", messageId}                 the message card: take a message back inside its 30 s hold / read where it is now
 * A plain route, not a server action: a server action makes Next draw the page again under the open chat (and would keep the value in its own request log in development).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (assistantWorkScreens(tenantId) !== "on" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers: HEADERS });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers: HEADERS });
  }
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.text();
    const json: unknown = raw.length <= 150_000 ? JSON.parse(raw) : null;
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
        return ok({ plan: planToWire(await decidePlan(user.accessToken, tenantId, planId, body.decision, body.confirmed === true)) });
      }
      case "undo": {
        const planId = id("planId");
        if (!planId) return new NextResponse(null, { status: 400, headers: HEADERS });
        return ok({ plan: planToWire(await undoPlan(user.accessToken, tenantId, planId)) });
      }
      case "secret": {
        const requestId = id("requestId");
        const value = typeof body.value === "string" ? body.value : "";
        if (!requestId || value.trim() === "" || value.length > 4000) return new NextResponse(null, { status: 400, headers: HEADERS });
        if (role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
        try {
          return ok({ last4: (await saveAssistantSecret(user.accessToken, tenantId, requestId, value)).last4 });
        } catch (error) {
          if (error instanceof ApiAuthError) throw error;
          return NextResponse.json({ ok: false, error: secretWord(error) }, { headers: HEADERS }); // a closed word only: never the error, which could carry the request
        }
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
      case "undo_talk_prefs": {
        // "How it talks to you" changed by talking: the card's own Undo (the person's own choices, C1's POST /v1/me/talk-prefs/undo)
        if (typeof body.token !== "string" || !/^[\w-]{8,200}$/.test(body.token)) return new NextResponse(null, { status: 400, headers: HEADERS });
        try {
          await postUndoTalkPrefs(user.accessToken, body.token);
          return ok({});
        } catch (error) {
          if (error instanceof ApiAuthError) throw error;
          return NextResponse.json({ ok: false, error: error instanceof ApiRequestError && error.status === 409 ? "changed" : error instanceof ApiRequestError && error.status === 404 ? "expired" : "down" }, { headers: HEADERS });
        }
      }
      case "message_undo":
      case "message_status": {
        const messageId = id("messageId");
        if (!messageId) return new NextResponse(null, { status: 400, headers: HEADERS });
        try {
          if (body.op === "message_status") return ok({ ...(await readMessageProgress(user.accessToken, tenantId, messageId)) });
          if (role !== "owner" && role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { headers: HEADERS });
          await unsendOutboxMessage(user.accessToken, tenantId, messageId);
          return ok({});
        } catch (error) {
          if (error instanceof ApiAuthError) throw error;
          const late = error instanceof ApiRequestError && (error.status === 409 || error.code === "outbox_state");
          return NextResponse.json({ ok: false, error: late ? "late" : error instanceof ApiRequestError && error.status === 403 ? "forbidden" : "down" }, { headers: HEADERS });
        }
      }
      case "import_get":
      case "import_edit":
      case "import_confirm":
      case "import_destination":
      case "import_cancel": {
        const importId = id("importId");
        if (!importId) return new NextResponse(null, { status: 400, headers: HEADERS });
        try {
          if (body.op === "import_get") return ok({ draft: importDraftToWire(await getImport(user.accessToken, tenantId, importId, typeof body.cursor === "string" && body.cursor.length <= 200 ? body.cursor : null)) });
          if (body.op === "import_destination") {
            const destination = (IMPORT_DESTINATIONS as readonly unknown[]).includes(body.destination) ? (body.destination as (typeof IMPORT_DESTINATIONS)[number]) : null;
            if (!destination) return new NextResponse(null, { status: 400, headers: HEADERS });
            return ok({ draft: importDraftToWire(await setImportDestination(user.accessToken, tenantId, importId, destination)) });
          }
          if (body.op === "import_cancel") {
            await cancelImport(user.accessToken, tenantId, importId);
            return ok({});
          }
          if (body.op === "import_edit") {
            const cellOf = (x: unknown): { rowId: string; cell: string; value: string } | null => {
              const e = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
              return e && typeof e.rowId === "string" && /^[\w-]{1,40}$/.test(e.rowId) && typeof e.cell === "string" && /^[a-z_]{1,30}$/.test(e.cell) && typeof e.value === "string" && e.value.length <= 200 ? { rowId: e.rowId, cell: e.cell, value: e.value } : null;
            };
            const incOf = (x: unknown): { rowId: string; include: boolean } | null => {
              const e = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
              return e && typeof e.rowId === "string" && /^[\w-]{1,40}$/.test(e.rowId) && typeof e.include === "boolean" ? { rowId: e.rowId, include: e.include } : null;
            };
            const edits = (Array.isArray(body.edits) ? body.edits.slice(0, 200) : []).map(cellOf).filter((x): x is NonNullable<typeof x> => x !== null);
            const include = (Array.isArray(body.include) ? body.include.slice(0, 200) : []).map(incOf).filter((x): x is NonNullable<typeof x> => x !== null);
            if (edits.length === 0 && include.length === 0) return new NextResponse(null, { status: 400, headers: HEADERS });
            return ok({ counts: countsToWire(await patchImportRows(user.accessToken, tenantId, importId, { edits, include })) });
          }
          const source = (CONSENT_SOURCES as readonly unknown[]).includes(body.consentSource) ? (body.consentSource as ConsentSource) : null;
          const exclude = (Array.isArray(body.excludeRowIds) ? body.excludeRowIds.slice(0, 5000) : []).filter((x): x is string => typeof x === "string" && /^[\w-]{1,40}$/.test(x));
          return ok({ plan: planToWire(await confirmImport(user.accessToken, tenantId, importId, source, exclude)) });
        } catch (error) {
          if (error instanceof ApiAuthError) throw error;
          return NextResponse.json({ ok: false, error: importWord(error) }, { headers: HEADERS });
        }
      }
      default:
        return new NextResponse(null, { status: 400, headers: HEADERS });
    }
  } catch (error) {
    if (error instanceof ApiAuthError) return new NextResponse(null, { status: 401, headers: HEADERS });
    return NextResponse.json({ ok: false, error: word(error) }, { headers: HEADERS }); // never the error itself: for the secret op it could echo the request
  }
}
