import { clearJar, readJar, writeJar } from "@/lib/mock/jar";
import { phoneNumberScreens } from "@/lib/screens/flag";

import { NOTHING, STEPS, MOCK_NUMBER, isCity, isStep, parsePhone, type City, type PhoneNumber, type Step } from "./types";

/**
 * Where Settings > Phone number gets its state (job B6). `mock` = ONE small cookie of the browser (the test screen: nothing is bought, rented or rung); `on` = C1's API, which does not exist yet (ADR 0120 step 2), so the part says it is not available; `off` = the part is not there.
 * Every move checks its input again here (the browser is not trusted). Only the Owner changes anything (the action checks the role).
 */
export const COOKIE = "sme_phone_number_mock";
export type Read = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: PhoneNumber; mock: boolean };
export type Moved = { ok: true; data: PhoneNumber } | { ok: false; error: "invalid" | "state" | "not_available" };

export async function readPhone(): Promise<Read> {
  const mode = phoneNumberScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") return { mode: "unavailable" };
  return { mode: "ok", data: await readJar(COOKIE, parsePhone, NOTHING), mock: true };
}

async function keep(next: PhoneNumber): Promise<Moved> {
  return (await writeJar(COOKIE, next)) ? { ok: true, data: next } : { ok: false, error: "invalid" };
}

/** Pick a city: the (made-up) number is reserved and the KYC steps start. Only from "not set up". */
export async function requestNumber(city: unknown): Promise<Moved> {
  if (phoneNumberScreens() !== "mock") return { ok: false, error: "not_available" };
  if (!isCity(city)) return { ok: false, error: "invalid" };
  const now = await readJar(COOKIE, parsePhone, NOTHING);
  if (now.state !== "not_set_up") return { ok: false, error: "state" };
  return keep({ state: "kyc_pending", city: city as City, number: MOCK_NUMBER[city as City], done: [] });
}

/** The test screen's stand-in for the provider saying a KYC step is approved. When every step is, the number is active. */
export async function approveStep(step: unknown): Promise<Moved> {
  if (phoneNumberScreens() !== "mock") return { ok: false, error: "not_available" };
  if (!isStep(step)) return { ok: false, error: "invalid" };
  const now = await readJar(COOKIE, parsePhone, NOTHING);
  if (now.state !== "kyc_pending") return { ok: false, error: "state" };
  const done = STEPS.filter((s) => s === step || now.done.includes(s));
  return keep({ ...now, done: done as Step[], state: done.length === STEPS.length ? "active" : "kyc_pending" });
}

/** Give the number back (from "kyc pending" or "active"). */
export async function releaseNumber(): Promise<Moved> {
  if (phoneNumberScreens() !== "mock") return { ok: false, error: "not_available" };
  await clearJar(COOKIE);
  return { ok: true, data: NOTHING };
}
