"use server";

import { redirect } from "next/navigation";

import { staffSource } from "@/lib/staff/load";
import { parseTotpCode } from "@/lib/auth/otp";
import { GOODWILL_MAX_RUPEES, GOODWILL_MIN_RUPEES, REASONS, wordsProblem } from "@/lib/staff/reasons";
import type { Failure } from "@/lib/staff/source";
import type { BusinessRow, GoodwillResult, SearchResults, TicketStatus, TicketThread, Unmasked } from "@/lib/staff/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The two things the staff console does from the browser, as server actions (so the browser talks only to this app and the API sees the signed-in person's own token): the Cmd+K search, and asking for a reason-logged, read-only look at a business.
 * The inputs are checked here again (the API checks them a third time); a refusal comes back as a closed word, never as the API's message.
 */
export type SearchOutcome = { ok: true; results: SearchResults } | { ok: false; failure: Failure };
export type AccessOutcome = { ok: true; href: string } | { ok: false; failure: Failure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function searchStaffAction(q: string): Promise<SearchOutcome> {
  const { source } = await staffSource();
  const text = typeof q === "string" ? q.trim() : "";
  if (text.length < 2 || text.length > 80) return { ok: true, results: { businesses: [], invoices: [], tickets: [] } };
  const found = await source.search(text);
  return found.ok ? { ok: true, results: found.data } : { ok: false, failure: found.failure };
}

export async function openAccessAction(tenantId: string, reasonCode: string, reasonText: string): Promise<AccessOutcome> {
  const { source, mock, role } = await staffSource();
  const note = typeof reasonText === "string" ? reasonText.trim().slice(0, 300) : "";
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) return { ok: false, failure: "unavailable" };
  if (!REASONS.some((r) => r.code === reasonCode)) return { ok: false, failure: "reason_required" };
  const granted = await source.access(tenantId, reasonCode, note === "" ? null : note);
  if (!granted.ok) return { ok: false, failure: granted.failure };
  const query = new URLSearchParams({ access: granted.data.accessId });
  if (mock && role !== "owner") query.set("role", role);
  return { ok: true, href: `/staff/businesses/${encodeURIComponent(granted.data.tenantId)}?${query.toString()}` };
}

/** After "Your staff session ended": end this browser's session, then the sign-in page (a still-valid shop session would otherwise bounce straight back to /app). */
export async function staffSignOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?next=%2Fstaff");
}

// ---- Phase 2 (14 Nov): the support thread, pause / resume, goodwill credit, unmasking. Every input is checked here again (the API checks it a third time); a refusal is a closed word. ----
export type Outcome<T> = { ok: true; data: T } | { ok: false; failure: Failure };
const fail = (failure: Failure): { ok: false; failure: Failure } => ({ ok: false, failure });
const wrap = <T>(r: { ok: true; data: T } | { ok: false; failure: Failure }): Outcome<T> => (r.ok ? { ok: true, data: r.data } : fail(r.failure));
const idOk = (v: unknown): v is string => typeof v === "string" && /^[0-9A-Za-z-]{1,64}$/.test(v);
const noteOf = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 300) : "");
const codeOk = (v: unknown): v is string => typeof v === "string" && REASONS.some((r) => r.code === v);

export async function replyAction(ticketId: string, body: string, kind: string): Promise<Outcome<TicketThread>> {
  const { source } = await staffSource();
  const text = typeof body === "string" ? body.trim() : "";
  if (!idOk(ticketId) || text.length < 1 || text.length > 4000 || (kind !== "reply" && kind !== "note")) return fail("invalid");
  return wrap(await source.reply(ticketId, text, kind));
}

export async function statusAction(ticketId: string, status: string): Promise<Outcome<TicketThread>> {
  const { source } = await staffSource();
  if (!idOk(ticketId) || (status !== "open" && status !== "waiting" && status !== "closed")) return fail("invalid");
  return wrap(await source.setStatus(ticketId, status as TicketStatus));
}

export async function assignAction(ticketId: string, who: string): Promise<Outcome<TicketThread>> {
  const { source } = await staffSource();
  if (!idOk(ticketId) || (who !== "me" && who !== "none")) return fail("invalid");
  return wrap(await source.assign(ticketId, who));
}

async function pauseOrResume(which: "pause" | "resume", tenantId: string, code: string, text: string): Promise<Outcome<BusinessRow>> {
  const { source } = await staffSource();
  const note = noteOf(text);
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) return fail("invalid");
  if (!codeOk(code) || (code === "other" && note.length < 3)) return fail("reason_required");
  return wrap(await (which === "pause" ? source.pause(tenantId, code, note || null) : source.resume(tenantId, code, note || null)));
}
export const pauseAction = (tenantId: string, code: string, text: string) => pauseOrResume("pause", tenantId, code, text);
export const resumeAction = (tenantId: string, code: string, text: string) => pauseOrResume("resume", tenantId, code, text);

export interface CreditForm {
  amountPaise: number;
  confirmPaise: number;
  code: string;
  text: string;
  key: string;
}
export async function creditAction(tenantId: string, form: CreditForm): Promise<Outcome<GoodwillResult>> {
  const { source } = await staffSource();
  if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof form !== "object" || form === null) return fail("invalid");
  const { amountPaise, confirmPaise, code, key } = form;
  const text = noteOf(form.text);
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= GOODWILL_MIN_RUPEES * 100 && n <= GOODWILL_MAX_RUPEES * 100 && n % 100 === 0;
  if (!whole(amountPaise) || amountPaise !== confirmPaise) return fail("invalid");
  if (!codeOk(code) || wordsProblem(code, text) !== null) return fail("reason_required");
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail("invalid");
  return wrap(await source.credit(tenantId, { amountPaise, confirmPaise, code, text, key }));
}

/** The 6-digit code for a money step: the same authenticator challenge as sign-in (Supabase MFA), which refreshes this browser's session; the page then sends the SAME credit again with the SAME key. */
export async function confirmCodeAction(code: string): Promise<{ ok: true } | { ok: false; failure: "invalid" | Failure }> {
  const { source, mock } = await staffSource();
  const digits = parseTotpCode(code);
  if (!digits) return { ok: false, failure: "invalid" };
  if (mock) {
    await source.freshCode(); // the sample accepts any 6 digits
    return { ok: true };
  }
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) return fail("no_access");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
  return error ? { ok: false, failure: "invalid" } : { ok: true };
}

export async function unmaskAction(tenantId: string, accessId: string, code: string, text: string): Promise<Outcome<Unmasked>> {
  const { source } = await staffSource();
  const note = noteOf(text);
  if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof accessId !== "string" || accessId.length < 1 || accessId.length > 80) return fail("invalid");
  if (!codeOk(code) || wordsProblem(code, note) !== null) return fail("reason_required");
  return wrap(await source.unmask(tenantId, accessId, code, note));
}
