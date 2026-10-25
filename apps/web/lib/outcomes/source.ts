import { cookies } from "next/headers";

import { outcomeScreens } from "@/lib/screens/flag";

import { MOCK_COOKIE, encodeCorrections, mockOutcomes, mockTotals, parseCorrections } from "./mock";
import { CATEGORIES_OF, isCategory, isResult, type CtxOutcomes, type Outcome, type OutcomeTotals, type Read } from "./types";

/**
 * Where the outcome screens get what happened after a call or a follow-up, and where an owner's correction goes (job DM). `mock` = the invented outcomes of lib/outcomes/mock.ts; `on` = C1's API, which is not published yet
 * (contract-outcomes.md), so the screens say "Not available yet" and never a guess; `off` = nothing is drawn. SERVER ONLY.
 */
export async function readCustomerOutcomes(_ctx: CtxOutcomes, leadId: string, now: Date = new Date()): Promise<Read<Outcome[]>> {
  const mode = outcomeScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") return { mode: "unavailable" };
  return { mode: "ok", data: mockOutcomes(leadId, now, parseCorrections((await cookies()).get(MOCK_COOKIE)?.value)) };
}

export async function readOutcomeTotals(ctx: CtxOutcomes): Promise<Read<OutcomeTotals>> {
  void ctx; // the fake data needs none; the API of C1 will ask for the workspace
  const mode = outcomeScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") return { mode: "unavailable" };
  return { mode: "ok", data: mockTotals() };
}

export type CorrectResult = { ok: true } | { ok: false; error: "not_available" | "invalid" };

/** The owner's correction of one outcome: a result and a category that go together. In mock mode it is kept in the cookie; with the real API it is POST …/outcomes/{id}/correct (when it exists). */
export async function correctOutcome(_ctx: CtxOutcomes, id: string, result: string, category: string): Promise<CorrectResult> {
  const mode = outcomeScreens();
  if (mode !== "mock") return { ok: false, error: "not_available" };
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !isResult(result) || !isCategory(category) || !CATEGORIES_OF[result].includes(category)) return { ok: false, error: "invalid" };
  const jar = await cookies();
  const have = parseCorrections(jar.get(MOCK_COOKIE)?.value);
  jar.set(MOCK_COOKIE, encodeCorrections({ ...have, [id]: [result, category] }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
  return { ok: true };
}
