import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { getMyConsents, postGrievance, putMarketingConsent } from "@/lib/api/dpdp";
import { dpdpScreens } from "@/lib/screens/flag";

import { MOCK_COOKIE, encode, parse, setMarketing, toConsents } from "./mock";
import type { ConsentVia, Consents, GrievanceInput, GrievanceResult, MarketingResult } from "./types";

/**
 * Where the DPDP settings get their data (job DQ part 2). `mock` = lib/dpdp/mock.ts (a cookie); `on` = C1's API (lib/api/dpdp.ts); `off` = the parts are not there. SERVER ONLY.
 */
export const dpdpMode = dpdpScreens;

/** The person's consent record, or null when it cannot be read ("Not available yet"). */
export async function readConsents(token: string): Promise<Consents | null> {
  try {
    if (dpdpScreens() === "mock") return toConsents(parse((await cookies()).get(MOCK_COOKIE)?.value));
    return await getMyConsents(token);
  } catch {
    return null;
  }
}

export async function changeMarketing(token: string, given: boolean, via: ConsentVia = "settings"): Promise<MarketingResult> {
  try {
    if (dpdpScreens() === "mock") {
      const jar = await cookies();
      const next = setMarketing(parse(jar.get(MOCK_COOKIE)?.value), given, via, new Date());
      jar.set(MOCK_COOKIE, encode(next), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
      return { ok: true, consents: toConsents(next) };
    }
    return { ok: true, consents: await putMarketingConsent(token, given, via) };
  } catch {
    return { ok: false, error: "down" };
  }
}

/** A grievance: checked here (the API checks again), then posted without a sign-in. `mock` answers with a fake reference and keeps nothing. */
export async function raiseGrievance(input: GrievanceInput, now: Date = new Date()): Promise<GrievanceResult> {
  if (dpdpScreens() === "mock") {
    const due = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    return { ok: true, reference: `GR-${now.getUTCFullYear()}-000001`, answerDueOn: due, answerWithinDays: 30 };
  }
  return postGrievance(input, randomUUID());
}
