"use server";

import { redirect } from "next/navigation";

import { staffSource } from "@/lib/staff/load";
import { REASONS } from "@/lib/staff/reasons";
import type { Failure } from "@/lib/staff/source";
import type { SearchResults } from "@/lib/staff/types";
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
