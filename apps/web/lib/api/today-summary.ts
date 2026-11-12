import { cache } from "react";

import { shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";

import { bootstrapPart } from "./bootstrap";
import type { CallBrief } from "./calls";
import { ApiAuthError, ApiRequestError, apiRequestOnce, isBusy, refusal } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Today in one request (C1's call-capacity plan, docs/contracts/today-summary.md, owner approved 12 Nov 2026): `GET /v1/tenants/{id}/today/summary?skip=...` runs the ~25 reads of the Today page inside the API and answers
 * `{as_of, sections: {name: {state: ok|not_for_you|slow|error, data, retry, error}}}`; each `ok` section is the SAME body as its own route, so every reader and parser of the page works unchanged: `apiRequest` (client.ts) asks here
 * (after the bootstrap) for a route the summary ran, with the very same path and query. SERVER ONLY (client.ts reaches this file through a lazy import behind `typeof window === "undefined"`).
 * Behind TODAY_SUMMARY_SCREENS=1 (off by default). It is used only after the Today page has PRIMED it for this request (`primeTodaySummary`): any other page or a route handler keeps asking its own routes. Anything it does not
 * hold (a route with another query, a section that is absent, one that is still slow after its follow-up, an API without the route, a part that broke or timed out) is simply asked on its own route: the old path is the fallback.
 * `not_for_you` and a 4xx part answer as the route would (a refusal); an API that refuses the WHOLE request as busy makes every part busy (no twenty fallback reads piled on top of it), like the bootstrap.
 */
export const todaySummaryOn = (): boolean => process.env.TODAY_SUMMARY_SCREENS === "1";

type Part = { state?: unknown; data?: unknown; retry?: unknown; error?: { code?: unknown; status?: unknown } | null };
type Body = { as_of: string | null; sections: Record<string, Part> };
type Answer = { kind: "ok"; body: Body } | { kind: "busy"; error: ApiRequestError } | { kind: "none" };
type Primed = { token: string; tenantId: string; skip: string; answer: Promise<Answer>; followUp: Promise<Record<string, Part> | null> | null };

const BUSY_WAIT_MAX_S = 3;
const PROPOSAL_DAYS = 61; // what the API reads for `visits_proposed` (from today, India, for 61 more days)

/** Routes of the first wave: path (after the workspace) -> [section, the query the summary ran, sorted]. A route with any other query is not the summary's: it is asked on its own. */
export const FIXED: Record<string, [string, string]> = {
  "/today": ["today", ""],
  "/agents/status": ["agents_status", ""],
  "/visits/today": ["visits_today", ""],
  "/ai-usage/week": ["ai_usage_week", ""],
  "/outbox/settings": ["outbox_settings", ""],
  "/quotes": ["quotes", "limit=50"],
  "/outreach/batches": ["lead_desk_batches", ""], // (the API's routes are under /outreach; the contract table lists them without the prefix: services/ai-api/app/bootstrap/today_summary.py is the truth)
  "/outreach/handoffs": ["lead_desk_handoffs", "open=true"],
  "/outreach/rules": ["lead_desk_rules", ""],
  "/tasks": ["lead_desk_tasks", "limit=100"],
  "/leads": ["lead_desk_leads", "limit=25"],
  "/prospects": ["lead_finder_prospects", "limit=5&status=needs_owner"],
  "/prospects/stats": ["lead_finder_stats", ""],
  // OPT-IN sections (`include=`, C1's #518): present only when the page asked for them, else absent and the route is asked on its own
  "/reports/run/education.today": ["pack_report_today", ""],
  "/campaigns": ["campaigns", "limit=50"],
  "/institution/admissions": ["institution_admissions", "limit=100"],
  "/materials/quotes": ["material_quotes", "limit=50"],
  "/ledger/summary": ["ledger_summary", "limit=100&party=company"],
  "/example-data": ["example_data", ""],
  "/outcomes/totals": ["outcomes_totals", ""],
  "/outbox/approvals": ["outbox_approvals", "limit=100"],
  "/call-requests": ["call_requests", "limit=100&status=requested"],
};
const ROUTE = /^\/v1\/tenants\/([0-9a-fA-F-]{36})(\/[a-z0-9/_.-]*)?(?:\?(.*))?$/;
const ITEMS = /^\/outreach\/batches\/([0-9a-fA-F-]{36})\/items$/;

const primed = cache((): { current: Primed | null } => ({ current: null }));

/** The sections the page will not draw (by role and by the flags that switch a part off): the API does not run them. At most 30 names. */
export function summarySkip(o: { role: "owner" | "admin" | "sales" | "viewer"; finderOn: boolean; outreachOn: boolean; tasksOn: boolean; leadsOn: boolean }): string[] {
  const manages = o.role === "owner" || o.role === "admin";
  const viewer = o.role === "viewer";
  const skip: string[] = [];
  const not = (cond: boolean, ...names: string[]) => {
    if (cond) skip.push(...names);
  };
  not(viewer, "visits_proposed");
  not(!manages, "ai_usage_week", "outbox_settings");
  not(viewer || !o.outreachOn, "lead_desk_batches", "lead_desk_handoffs");
  not(!manages || !o.outreachOn, "lead_desk_rules");
  not(!manages || !o.tasksOn, "lead_desk_tasks");
  not(!manages || !o.leadsOn, "lead_desk_leads"); // (a business type without a lead template does not draw them either; the API reads them anyway: one read, and the template list is not waited for)
  not(viewer || !o.finderOn, "lead_finder_prospects", "lead_finder_stats");
  return skip;
}

async function ask(token: string, tenantId: string, path: string): Promise<Answer> {
  for (let again = false; ; again = true) {
    try {
      const body = (await apiRequestOnce(`/v1/tenants/${tenantId}${path}`, token)) as { as_of?: unknown; sections?: unknown } | null;
      const sections = body && typeof body === "object" && body.sections && typeof body.sections === "object" && !Array.isArray(body.sections) ? (body.sections as Record<string, Part>) : null;
      return sections ? { kind: "ok", body: { as_of: typeof body?.as_of === "string" ? body.as_of : null, sections } } : { kind: "none" };
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      if (isBusy(error)) {
        if (again) return { kind: "busy", error: error as ApiRequestError };
        await new Promise((resolve) => setTimeout(resolve, Math.min((error as ApiRequestError).retryAfter ?? 2, BUSY_WAIT_MAX_S) * 1000));
        continue;
      }
      return { kind: "none" }; // an API without the route (404), unreachable or any other failure: every read asks its own route
    }
  }
}

/** Called by the Today page, once per request, as early as it knows what it will draw: starts the one request. Does nothing when TODAY_SUMMARY_SCREENS is off. */
export function primeTodaySummary(token: string, tenantId: string, skip: readonly string[] = [], more: { include?: readonly string[]; checks?: readonly string[] } = {}): void {
  if (!todaySummaryOn()) return;
  const clean = (list: readonly string[] | undefined, max: number) => (list ?? []).filter((n) => /^[a-z_]{1,40}$/.test(n)).slice(0, max).join(",");
  const names = clean(skip, 30);
  const include = clean(more.include, 20);
  // `students_imported` is not a check of the summary (ADR 0084, children's data: no module outside the education package names a student route): the web reads that one step itself, as it always did
  const checks = include.split(",").includes("setup_progress") ? clean((more.checks ?? []).filter((c) => c !== "students_imported"), 20) : "";
  const slot = primed();
  if (slot.current !== null && slot.current.tenantId === tenantId) return;
  const query = [names ? `skip=${names}` : "", include ? `include=${include}` : "", checks ? `checks=${checks}` : ""].filter(Boolean).join("&");
  slot.current = { token, tenantId, skip: names, answer: ask(token, tenantId, `/today/summary${query ? `?${query}` : ""}`), followUp: null };
  void slot.current.answer.catch(() => undefined); // (a rejected session is thrown to whoever reads a part, not as an unhandled rejection)
}

const RETRY = /^\/today\/summary\?only=([a-z_,]{1,200})(?:&checks=([a-z_,]{1,400}))?$/;

/**
 * ONE follow-up request for ALL the sections of the answer that were slow: `?only=a,b,c` (and the `checks` of `setup_progress` if it is one of them). Each slow section used to get its own retry request (staging, 12 Nov 2026, 22:55 UTC: sixteen
 * `?only=<name>` requests at once after one slow Today load; on a slow database they made it slower and ended in 502 and 503). Null = nothing came back (a section not in it is asked on its own route).
 */
function followUpOf(slot: Primed, sections: Record<string, Part>): Promise<Record<string, Part> | null> {
  if (slot.followUp) return slot.followUp;
  const names: string[] = [];
  let checks = "";
  for (const [name, part] of Object.entries(sections)) {
    const m = part && typeof part === "object" && part.state === "slow" && typeof part.retry === "string" ? RETRY.exec(part.retry) : null;
    if (m && m[1] === name && names.length < 30) {
      names.push(name);
      if (m[2]) checks = m[2];
    }
  }
  slot.followUp =
    names.length === 0
      ? Promise.resolve(null)
      : ask(slot.token, slot.tenantId, `/today/summary?only=${names.join(",")}${checks ? `&checks=${checks}` : ""}`).then((r) => (r.kind === "ok" ? r.body.sections : null));
  return slot.followUp;
}

/** The section's final state: a slow one is followed up through the ONE follow-up request of the answer; null = not held (absent, still slow, no answer). */
async function section(slot: Primed, name: string): Promise<Part | null | { busy: ApiRequestError }> {
  const answer = await slot.answer;
  if (answer.kind === "none") return null;
  if (answer.kind === "busy") return { busy: answer.error };
  const part = answer.body.sections[name];
  if (!part || typeof part !== "object") return null;
  if (part.state !== "slow") return part;
  const got = await followUpOf(slot, answer.body.sections);
  const again = got?.[name];
  return again && typeof again === "object" ? again : null;
}

const here = (tenantId: string): Primed | null => {
  const slot = primed().current;
  return slot !== null && slot.tenantId.toLowerCase() === tenantId.toLowerCase() ? slot : null;
};
const sorted = (query: string): string => [...new URLSearchParams(query)].map(([k, v]) => `${k}=${v}`).sort().join("&");
const isBusyAnswer = (x: Part | null | { busy: ApiRequestError }): x is { busy: ApiRequestError } => x !== null && "busy" in x;

/** What a part's state means for the reader that asked for its route: the body, `undefined` (ask the route yourself) or the refusal the route would have given. */
function outcome(part: Part | null | { busy: ApiRequestError }): { body: unknown } | undefined {
  if (part === null) return undefined;
  if (isBusyAnswer(part)) throw part.busy;
  if (part.state === "ok") return part.data === undefined || part.data === null ? undefined : { body: part.data };
  if (part.state === "not_for_you") throw refusal(403, { error: { code: "forbidden", message: "Request failed." } });
  if (part.state === "error") {
    const status = typeof part.error?.status === "number" ? part.error.status : 0;
    const code = typeof part.error?.code === "string" && /^[a-z_]{1,40}$/.test(part.error.code) ? part.error.code : "http_error";
    if (status === 0 || status === 503 || status >= 500) return undefined; // timed out or broken: that one route is asked on its own
    throw refusal(status, { error: { code, message: "Request failed." } });
  }
  return undefined; // slow and not finished, or a state this web does not know
}

/** Which section answers `path` (route + query), and the key inside it for the per-batch items; null = not a route the summary ran with this query. */
function sectionOf(path: string, asOf: string | null): { name: string; key?: string } | null {
  const m = ROUTE.exec(path);
  if (!m) return null;
  const route = m[2] ?? "";
  const query = sorted(m[3] ?? "");
  const fixed = FIXED[route];
  if (fixed) return fixed[1] === query ? { name: fixed[0] } : null;
  const day = asOf === null || Number.isNaN(Date.parse(asOf)) ? null : todayInIndia(Date.parse(asOf));
  if (day === null) return null; // (the date the summary used is the API's `as_of`: without it the date-bound reads are asked on their own)
  if (route === "/visits/slots") return query === `date=${day}` ? { name: "visit_slots" } : null;
  if (route === "/trips") return query === `date=${day}` ? { name: "trips_today" } : null;
  if (route === "/visits") return query === `from=${day}&status=booked&to=${shiftDay(day, PROPOSAL_DAYS)}` ? { name: "visits_proposed" } : null;
  const items = ITEMS.exec(route);
  if (items && query === "") return { name: "lead_desk_batch_items", key: items[1].toLowerCase() };
  return null;
}

/**
 * The body of `path` from the summary, or `undefined` when this route is not served from it (nothing primed, another workspace, another query, an absent or unfinished section): the caller then asks the route itself.
 * Throws what the route would have thrown when the part was refused. Called by `apiRequest` (client.ts) for a GET on the server.
 */
export async function summaryPart(path: string): Promise<{ body: unknown } | undefined> {
  const m = ROUTE.exec(path);
  const slot = m ? here(m[1]) : null;
  if (!m || slot === null) return undefined;
  const answer = await slot.answer;
  if (answer.kind === "none") return undefined;
  if (answer.kind === "busy") throw answer.error;
  const found = sectionOf(path, answer.body.as_of);
  if (found === null || slot.skip.split(",").includes(found.name)) return undefined; // (a skipped section is absent: the page asked for what it said it would not)
  const hit = outcome(await section(slot, found.name));
  if (hit === undefined || found.key === undefined) return hit;
  const all = hit.body;
  const own = all && typeof all === "object" && !Array.isArray(all) ? (all as Record<string, unknown>)[found.key] : undefined;
  return own === undefined ? undefined : { body: own }; // (a batch the summary did not read: asked on its own)
}

/** The layout's bootstrap first (it holds `today` and `agents/status` for the whole frame), then the summary. client.ts reaches both through this one lazy import. */
export async function primedPart(path: string): Promise<{ body: unknown } | undefined> {
  return (await bootstrapPart(path)) ?? (await summaryPart(path));
}

/**
 * What the "asked for a person" card needs of a call, from the summary's derived `call_briefs` (keyed by the call id; the transcript is never sent). `undefined` = the summary does not hold it (ask `GET /calls/{id}`);
 * `null` = the section was read and has nothing for this call (its read failed on the API side: the card keeps no "Call back", as before).
 */
export async function summaryBrief(tenantId: string, callId: string): Promise<CallBrief | null | undefined> {
  const slot = here(tenantId);
  if (slot === null || slot.skip.split(",").includes("call_briefs")) return undefined;
  const hit = outcome(await section(slot, "call_briefs").catch(() => null));
  if (hit === undefined) return undefined;
  const all = hit.body;
  if (!all || typeof all !== "object" || Array.isArray(all)) return undefined;
  const one = (all as Record<string, unknown>)[callId];
  if (one === undefined || one === null || typeof one !== "object") return null;
  const b = one as Record<string, unknown>;
  const gist = typeof b.summary_short === "string" && b.summary_short.trim() !== "" && b.summary_short.length <= 300 ? b.summary_short.trim() : null;
  const at = b.visit_at;
  return { leadId: typeof b.lead_id === "string" && isCanonicalUuid(b.lead_id) ? b.lead_id : null, gist, visitAt: typeof at === "string" && at.length <= 40 && !Number.isNaN(Date.parse(at)) ? at : null };
}

/** The enquiry a quote belongs to, from the summary's derived `quote_enquiries`. `undefined` = not held (ask `GET /quotes/{id}`); `null` = read, and the API could not place it. */
export async function summaryEnquiry(tenantId: string, quoteId: string): Promise<string | null | undefined> {
  const slot = here(tenantId);
  if (slot === null || slot.skip.split(",").includes("quote_enquiries")) return undefined;
  const hit = outcome(await section(slot, "quote_enquiries").catch(() => null));
  if (hit === undefined) return undefined;
  const all = hit.body;
  if (!all || typeof all !== "object" || Array.isArray(all)) return undefined;
  const id = (all as Record<string, unknown>)[quoteId];
  return typeof id === "string" && isCanonicalUuid(id) ? id : null;
}

/**
 * What the page asks of the summary BEYOND the default sections (C1's opt-in `include=`, docs/contracts/today-summary.md): the cards of the business type's own modules, the example-data line, the outcome totals and the setup
 * checklist's facts (`setup_progress`, with the checks this business type's steps use). Only what the page will draw: nothing is asked for a Viewer, and a Sales member gets no checklist and no campaign card.
 */
export function summaryInclude(o: { role: "owner" | "admin" | "sales" | "viewer"; modules: readonly string[] | null; checks: readonly string[]; outcomesOn: boolean }): string[] {
  const has = (m: string) => o.modules !== null && o.modules.includes(m);
  const manages = o.role === "owner" || o.role === "admin";
  const include: string[] = [];
  if (o.modules !== null && o.role !== "viewer") {
    if (has("deliveries")) include.push("trips_today");
    if (has("materials")) include.push("material_quotes");
    if (has("dues") && !has("fees")) include.push("ledger_summary");
    if (has("fees")) include.push("pack_report_today");
    if (has("programmes") && has("campaigns") && o.role !== "sales") include.push("campaigns");
    if (has("programmes")) include.push("institution_admissions");
  }
  if (manages && o.modules !== null) include.push("example_data");
  if (o.role !== "viewer" && o.outcomesOn) include.push("outcomes_totals");
  if (manages && o.checks.length > 0) include.push("setup_progress");
  return include;
}

/** The checklist's facts from the summary's `setup_progress` (`{check: true|false|null}`): `undefined` = not held (ask each fact's own route); a check that came back `null` (its read failed on the API side) is left out so its own route is asked. */
export async function summarySetup(tenantId: string): Promise<Partial<Record<string, boolean>> | undefined> {
  const slot = here(tenantId);
  if (slot === null || slot.skip.split(",").includes("setup_progress")) return undefined;
  const hit = outcome(await section(slot, "setup_progress").catch(() => null));
  if (hit === undefined) return undefined;
  const all = hit.body;
  if (!all || typeof all !== "object" || Array.isArray(all)) return undefined;
  const out: Partial<Record<string, boolean>> = {};
  for (const [k, v] of Object.entries(all as Record<string, unknown>)) if (typeof v === "boolean") out[k] = v;
  return out;
}
