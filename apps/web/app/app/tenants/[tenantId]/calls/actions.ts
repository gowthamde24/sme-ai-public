"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { correctCall, hangUpCall, type Correction } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { appV4 } from "@/lib/screens/flag";

/**
 * The Calls pages' two moves (app v4 part 4, docs/contracts/calls.md):
 * - "Correct it" (Owner, Admin, Sales): the person's own summary, facts and a note for next time. The AI's own summary stays as it was; the latest five notes go into later calls, so a note with a phone number or an e-mail address is refused.
 * - "End call" (Owner, Admin): POST hang-up. Nothing else on a live call is offered yet (Whisper, Take over and Transfer show only once the API has them).
 * The workspace and the call are the ones the page bound; the role is checked here and again by the API.
 */
export type CorrectError = "contact" | "empty" | "forbidden" | "invalid" | "not_available" | "down";
export type CorrectResult = { ok: true; data: Correction } | { ok: false; error: CorrectError };
const CONTACT = /\+?\d[\d\s-]{7,}\d|[^\s@]+@[^\s@]+\.[^\s@]+/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function correctCallAction(tenantId: string, callId: string, input: unknown): Promise<CorrectResult> {
  if (!appV4()) return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId) || !isRec(input)) return { ok: false, error: "invalid" };
  const body: { summary?: string; captured?: Record<string, string>; note?: string } = {};
  if (input.summary !== undefined) {
    if (typeof input.summary !== "string" || input.summary.length > 600) return { ok: false, error: "invalid" };
    body.summary = input.summary.trim();
  }
  if (input.note !== undefined) {
    if (typeof input.note !== "string" || input.note.length > 300) return { ok: false, error: "invalid" };
    if (CONTACT.test(input.note)) return { ok: false, error: "contact" }; // checked again by the API (correction_invalid)
    body.note = input.note.trim();
  }
  if (input.captured !== undefined) {
    if (!isRec(input.captured) || Object.keys(input.captured).length > 30) return { ok: false, error: "invalid" };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.captured)) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || typeof v !== "string" || v.length > 200) return { ok: false, error: "invalid" };
      if (v.trim() !== "") out[k] = v.trim();
    }
    body.captured = out;
  }
  if (!Object.keys(body).length) return { ok: false, error: "empty" };
  const user = await requireUser();
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role === "viewer") return { ok: false, error: "forbidden" };
    const data = await correctCall(user.accessToken, tenantId, callId, body);
    revalidatePath(`/app/tenants/${tenantId}/calls/${callId}`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "correction_invalid") return { ok: false, error: "contact" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422) return { ok: false, error: "empty" };
    }
    return { ok: false, error: "down" };
  }
}

export type HangUpResult = { ok: true } | { ok: false; error: "forbidden" | "not_here" | "not_available" | "down" };
export async function hangUpCallAction(tenantId: string, callId: string): Promise<HangUpResult> {
  if (!appV4()) return { ok: false, error: "not_available" };
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId)) return { ok: false, error: "forbidden" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
    await hangUpCall(user.accessToken, tenantId, callId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.code === "call_not_here" || error.status === 409) return { ok: false, error: "not_here" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "down" };
  }
}
