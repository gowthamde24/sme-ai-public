import { cookies } from "next/headers";

import { ApiRequestError } from "@/lib/api/client";
import { getCustomerOutcomes, getOutcomeTotals, postOutcomeCorrection } from "@/lib/api/outcomes";
import { outcomeScreens } from "@/lib/screens/flag";

import { MOCK_COOKIE, encodeCorrections, mockOutcomes, mockTotals, parseCorrections } from "./mock";
import { CATEGORIES_OF, NO_CATEGORY, isCategory, isResult, type CtxOutcomes, type Outcome, type OutcomeTotals, type Read } from "./types";

/**
 * Where the outcome screens get what happened after a call or a follow-up, and where an owner's correction goes (jobs DM and DO). `mock` = the invented outcomes of lib/outcomes/mock.ts; `on` = C1's API (lib/api/outcomes.ts);
 * `off` = nothing is drawn. A read that fails is "Not available yet" and never a guess. SERVER ONLY.
 */
export async function readCustomerOutcomes(ctx: CtxOutcomes, leadId: string, now: Date = new Date()): Promise<Read<Outcome[]>> {
  const mode = outcomeScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") {
    try {
      return { mode: "ok", data: await getCustomerOutcomes(ctx.token, ctx.tenantId, leadId) };
    } catch {
      return { mode: "unavailable" };
    }
  }
  return { mode: "ok", data: mockOutcomes(leadId, now, parseCorrections((await cookies()).get(MOCK_COOKIE)?.value)) };
}

export async function readOutcomeTotals(ctx: CtxOutcomes): Promise<Read<OutcomeTotals>> {
  const mode = outcomeScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") {
    try {
      return { mode: "ok", data: await getOutcomeTotals(ctx.token, ctx.tenantId) };
    } catch {
      return { mode: "unavailable" };
    }
  }
  return { mode: "ok", data: mockTotals() };
}

export type CorrectResult = { ok: true } | { ok: false; error: "not_available" | "invalid" };

/** The owner's correction of one outcome: a result and a category that go together (an unclear one may have none). In mock mode it is kept in the cookie; with the API it is `POST …/outcomes/{id}/correct`. */
export async function correctOutcome(ctx: CtxOutcomes, id: string, result: string, category: string): Promise<CorrectResult> {
  const mode = outcomeScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const none = category === NO_CATEGORY && result === "unclear";
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !isResult(result) || !(none || (isCategory(category) && CATEGORIES_OF[result].includes(category)))) return { ok: false, error: "invalid" };
  if (mode === "on") {
    try {
      await postOutcomeCorrection(ctx.token, ctx.tenantId, id, result, none ? null : category);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof ApiRequestError && error.status === 422 ? "invalid" : "not_available" };
    }
  }
  if (none) return { ok: false, error: "invalid" }; // the fake data has no "unclear without a kind"
  const jar = await cookies();
  const have = parseCorrections(jar.get(MOCK_COOKIE)?.value);
  jar.set(MOCK_COOKIE, encodeCorrections({ ...have, [id]: [result, category as never] }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
  return { ok: true };
}
