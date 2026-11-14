import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import type { ScreenMode } from "@/lib/screens/flag";

import { apiAccess, apiAssign, apiBusinesses, apiBusinessView, apiGoodwill, apiMe, apiOverview, apiPause, apiReply, apiResume, apiSearch, apiThread, apiTicketStatus, apiTickets, apiUnmask } from "./api";
import { type MockJar, cookieJar, mockBody } from "./mock-state";
import { REASONS } from "./reasons";
import { type MockState, accessJson, businessById, businessesJson, businessWith, meJson, overviewJson, searchJson, supportViewJson, threadJson, ticketIndex, ticketsJson, unmaskedJson } from "./staff-fixtures";
import { type AccessGrant, type BusinessList, type BusinessRow, type GoodwillResult, type Overview, type SearchResults, type StaffMe, type StaffRole, type SupportView, type TicketList, type TicketStatus, type TicketThread, type Unmasked, STAFF_ROLES, parseAccess, parseBusinessList, parseBusinessRow, parseGoodwill, parseMe, parseOverview, parseSearch, parseSupportView, parseThread, parseTicketList, parseUnmasked } from "./types";

/**
 * Where the staff console's data comes from: C1's admin API (`STAFF_CONSOLE=1`) or a fixed made-up sample (`mock`, role from `?role=`). One door for the layout, the pages and the actions, with ONE way to say what went wrong, so every screen
 * draws the same plain words and never a detail. SERVER ONLY.
 */
export type Failure =
  | "signed_out"
  | "no_access"
  | "unavailable"
  | "owner_ok_required"
  | "reason_required"
  | "access_required"
  | "second_confirm_required"
  | "goodwill_limit"
  | "ticket_closed"
  | "not_found"
  | "invalid";
/** `ref` = a short reference of an "unavailable" failure: it is in the server log with the reason, and the person can read it to support (the shop app's error page does the same). */
export type Result<T> = { ok: true; data: T } | { ok: false; failure: Failure; ref?: string };

/** What a refused or failed call means for the person. 401 = the staff session ended; 403 = no staff access (not_staff, second_factor_required, forbidden: never told apart on screen) except access_required and second_confirm_required (a fresh code is asked); 404 not found; 409 owner_ok_required / goodwill_limit / ticket_closed; 422 reason_required, else "invalid". */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiAuthError) return "signed_out";
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "signed_out";
    if (error.status === 403) return error.code === "access_required" ? "access_required" : error.code === "second_confirm_required" ? "second_confirm_required" : "no_access";
    if (error.status === 404) return "not_found";
    if (error.status === 409 && error.code === "owner_ok_required") return "owner_ok_required";
    if (error.status === 409 && error.code === "goodwill_limit") return "goodwill_limit";
    if (error.status === 409 && error.code === "ticket_closed") return "ticket_closed";
    if (error.status === 422) return error.code === "reason_required" ? "reason_required" : "invalid";
  }
  return "unavailable";
}

/** A short reference for one failure (8 hex characters): shown on the error page and written to the server log next to the reason. */
export function newRef(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What goes to the server log for an "unavailable" failure: the kind and, for an API refusal, its status and code; for an answer the page could not read, which field (the reader names fields, never values). Never a token, never the answer's content. */
export function describeFailure(error: unknown): { kind: "api" | "read" | "other"; status?: number; code?: string; message: string } {
  if (error instanceof ApiRequestError) return { kind: "api", status: error.status, code: error.code, message: error.message.slice(0, 160) };
  if (error instanceof ApiContractError) return { kind: "read", message: error.message.slice(0, 160) };
  if (error instanceof Error) return { kind: "other", message: error.message.slice(0, 160) };
  return { kind: "other", message: "unknown" };
}

async function attempt<T>(run: () => Promise<T>, where = "staff"): Promise<Result<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const failure = failureOf(error);
    if (failure !== "unavailable") return { ok: false, failure };
    const ref = newRef();
    console.error(JSON.stringify({ event: "staff_unavailable", ref, where, ...describeFailure(error) }));
    return { ok: false, failure, ref };
  }
}

/** `?role=owner|support|finance` of an address (only the mock reads it); anything else is the owner. */
export function mockRoleOf(pathAndQuery: string | null | undefined): StaffRole {
  const query = (pathAndQuery ?? "").split("?")[1] ?? "";
  const role = new URLSearchParams(query).get("role");
  return STAFF_ROLES.find((r) => r === role) ?? "owner";
}

export interface GoodwillInput {
  amountPaise: number;
  confirmPaise: number;
  code: string;
  text: string;
  key: string;
}

export interface Source {
  me(): Promise<Result<StaffMe>>;
  overview(): Promise<Result<Overview>>;
  search(q: string): Promise<Result<SearchResults>>;
  access(tenantId: string, reasonCode: string, reasonText: string | null): Promise<Result<AccessGrant>>;
  view(tenantId: string, accessId: string): Promise<Result<SupportView>>;
  tickets(status: TicketStatus | "active"): Promise<Result<TicketList>>;
  thread(id: string): Promise<Result<TicketThread>>;
  reply(id: string, body: string, kind: "reply" | "note"): Promise<Result<TicketThread>>;
  setStatus(id: string, status: TicketStatus): Promise<Result<TicketThread>>;
  /** `me` = assign to the signed-in person, `none` = unassign (the contract has no list of staff to pick from). */
  assign(id: string, who: "me" | "none"): Promise<Result<TicketThread>>;
  businesses(q: string, cursor: string | null): Promise<Result<BusinessList>>;
  pause(tenantId: string, code: string, text: string | null): Promise<Result<BusinessRow>>;
  resume(tenantId: string, code: string, text: string | null): Promise<Result<BusinessRow>>;
  credit(tenantId: string, input: GoodwillInput): Promise<Result<GoodwillResult>>;
  /** A fresh authenticator code was just entered (mock only: with the real API the sign-in session itself carries it; see actions.ts). */
  freshCode(): Promise<void>;
  unmask(tenantId: string, accessId: string, reasonCode: string, reasonText: string): Promise<Result<Unmasked>>;
}

const MINUTE = 60_000;

export function makeSource(mode: Exclude<ScreenMode, "off">, token: string, role: StaffRole, now: () => Date = () => new Date(), jar: MockJar = cookieJar, staffId = ""): Source {
  if (mode === "on") {
    return {
      me: () => attempt(() => apiMe(token)),
      overview: () => attempt(() => apiOverview(token)),
      search: (q) => attempt(() => apiSearch(token, q)),
      access: (tenantId, code, text) => attempt(() => apiAccess(token, tenantId, code, text)),
      view: (tenantId, accessId) => attempt(() => apiBusinessView(token, tenantId, accessId)),
      tickets: (status) => attempt(() => apiTickets(token, status)),
      thread: (id) => attempt(() => apiThread(token, id)),
      reply: (id, body, kind) => attempt(() => apiReply(token, id, body, kind)),
      setStatus: (id, status) => attempt(() => apiTicketStatus(token, id, status)),
      assign: (id, who) => attempt(async () => apiAssign(token, id, who === "me" ? await myId(token, staffId) : null)),
      businesses: (q, cursor) => attempt(() => apiBusinesses(token, q, cursor)),
      pause: (tenantId, code, text) => attempt(() => apiPause(token, tenantId, code, text)),
      resume: (tenantId, code, text) => attempt(() => apiResume(token, tenantId, code, text)),
      credit: (tenantId, input) => attempt(() => apiGoodwill(token, tenantId, input)),
      freshCode: async () => undefined,
      unmask: (tenantId, accessId, code, text) => attempt(() => apiUnmask(token, tenantId, accessId, code, text)),
    };
  }
  // the sample goes through the very readers the API's answers go through, and refuses what the API refuses (role, reasons, limits)
  const forbid = (): never => {
    throw new ApiRequestError(403, "forbidden", "Not allowed for this role.");
  };
  const supportish = () => (role === "finance" ? forbid() : undefined);
  const moneyish = () => (role === "support" ? forbid() : undefined);
  const needReason = (code: string, text: string | null) => {
    if (!REASONS.some((r) => r.code === code) || (code === "other" && (text ?? "").trim().length < 3)) throw new ApiRequestError(422, "reason_required", "A reason is required.");
  };
  const businessOrThrow = (tenantId: string) => businessById(tenantId) ?? ((): never => { throw new ApiRequestError(404, "not_found", "Not found."); })();
  const save = async (st: MockState) => {
    if (!(await jar.write(st))) throw new ApiRequestError(503, "mock_full", "The sample cannot remember more.");
  };
  const ticketAt = (id: string): number => ticketIndex(id) ?? ((): never => { throw new ApiRequestError(404, "not_found", "Not found."); })();
  const thread = async (id: string, st?: MockState) => parseThread(threadJson(id, now(), st ?? (await jar.read())) ?? ((): never => { throw new ApiRequestError(404, "not_found", "Not found."); })());
  const touch = async (id: string, change: (cur: MockState["tickets"][string]) => MockState["tickets"][string]): Promise<TicketThread> => {
    const i = ticketAt(id);
    const st = await jar.read();
    const next = { ...st, tickets: { ...st.tickets, [String(i)]: change(st.tickets[String(i)] ?? {}) } };
    await save(next);
    return thread(id, next);
  };
  return {
    me: () => attempt(async () => parseMe(meJson(role))),
    overview: () => attempt(async () => parseOverview(overviewJson(role, now()))),
    search: (q) => attempt(async () => parseSearch(searchJson(role, q, now()))),
    access: (tenantId, code, text) =>
      attempt(async () => {
        if (code === "other" && (text ?? "").trim().length < 3) throw new ApiRequestError(422, "reason_required", "A reason is required.");
        return parseAccess(accessJson(tenantId, now()));
      }),
    view: (tenantId, accessId) =>
      attempt(async () => {
        const json = accessId.startsWith("mock-access-") ? supportViewJson(tenantId, now(), await jar.read()) : null;
        if (!json) throw new ApiRequestError(403, "access_required", "Open the business first.");
        return parseSupportView(json);
      }),
    tickets: (status) =>
      attempt(async () => {
        supportish();
        return parseTicketList(ticketsJson(status, now(), await jar.read()));
      }),
    thread: (id) =>
      attempt(async () => {
        supportish();
        return thread(id);
      }),
    reply: (id, body, kind) =>
      attempt(async () => {
        supportish();
        const i = ticketAt(id);
        const cur = (await jar.read()).tickets[String(i)] ?? {};
        if ((cur.status ?? "open") === "closed") throw new ApiRequestError(409, "ticket_closed", "Reopen it first.");
        return touch(id, (c) => ({ ...c, ...(kind === "reply" ? { status: "waiting" as const } : {}), msgs: [...(c.msgs ?? []), { k: kind === "reply" ? ("r" as const) : ("n" as const), b: mockBody(body), t: now().getTime() }].slice(-4) }));
      }),
    setStatus: (id, status) =>
      attempt(async () => {
        supportish();
        return touch(id, (c) => ({ ...c, status }));
      }),
    assign: (id, who) =>
      attempt(async () => {
        supportish();
        return touch(id, (c) => ({ ...c, assignee: who }));
      }),
    businesses: (q) => attempt(async () => parseBusinessList(businessesJson(q, now(), await jar.read()))),
    pause: (tenantId, code, text) =>
      attempt(async () => {
        supportish();
        needReason(code, text);
        const b = businessOrThrow(tenantId);
        const st = await jar.read();
        const next = { ...st, paused: st.paused.includes(tenantId) ? st.paused : [...st.paused, tenantId] };
        await save(next);
        return parseBusinessRow(businessWith(b, now(), next));
      }),
    resume: (tenantId, code, text) =>
      attempt(async () => {
        supportish();
        needReason(code, text);
        const b = businessOrThrow(tenantId);
        const st = await jar.read();
        // a business that was paused by its owner (sample: Lakshmi Textiles) is not support's to lift
        if (!st.paused.includes(tenantId)) throw new ApiRequestError(422, "nothing_to_lift", "Nothing of support's to lift.");
        const next = { ...st, paused: st.paused.filter((t) => t !== tenantId) };
        await save(next);
        return parseBusinessRow(businessWith(b, now(), next));
      }),
    credit: (tenantId, input) =>
      attempt(async () => {
        moneyish();
        businessOrThrow(tenantId);
        if (input.amountPaise < 10_000 || input.amountPaise > 100_000 || input.amountPaise !== input.confirmPaise || input.text.trim().length < 3) throw new ApiRequestError(422, "validation_error", "Check the amount and the reason.");
        needReason(input.code, input.text);
        const st = await jar.read();
        if (st.fresh < now().getTime()) throw new ApiRequestError(403, "second_confirm_required", "Enter your authenticator code again to do this.");
        const so = st.credited[tenantId] ?? 0;
        if (so + input.amountPaise > 300_000) throw new ApiRequestError(409, "goodwill_limit", "Limit reached.");
        const next = { ...st, credited: { ...st.credited, [tenantId]: so + input.amountPaise } };
        await save(next);
        const b = businessById(tenantId)!;
        const row = businessWith(b, now(), next) as { balance_text: string };
        return parseGoodwill({ credited_paise: input.amountPaise, credited_text: `₹${(input.amountPaise / 100).toLocaleString("en-IN")}`, balance_paise: 0, balance_text: row.balance_text, replayed: false });
      }),
    freshCode: async () => {
      const st = await jar.read();
      await save({ ...st, fresh: now().getTime() + 5 * MINUTE });
    },
    unmask: (tenantId, accessId, code, text) =>
      attempt(async () => {
        supportish();
        if (!accessId.startsWith("mock-access-")) throw new ApiRequestError(403, "access_required", "Open the business first.");
        businessOrThrow(tenantId);
        needReason(code, text);
        if (text.trim().length < 3) throw new ApiRequestError(422, "reason_required", "A reason is required.");
        return parseUnmasked(unmaskedJson());
      }),
  };
}

/** The signed-in person's staff id (for "assign to me"): the one the page already read, else asked once. */
async function myId(token: string, known: string): Promise<string> {
  if (known) return known;
  const me = await apiMe(token);
  if (!me.staffId) throw new ApiRequestError(422, "validation_error", "No staff id.");
  return me.staffId;
}
