import { acceptUsage, claimNumber as apiClaim, listAvailable, listOwn, reasonOf } from "@/lib/api/numbers";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { clearJar, readJar, writeJar } from "@/lib/mock/jar";
import { kycPerClient, phonePicker } from "@/lib/screens/flag";

import { displayNumber, isNumber, isPrefix, isType, type ClaimResult, type NumberType, type OwnNumber, type PickNumber, type Refusal, type SearchResult } from "./types";

/**
 * Where the number picker gets its numbers. `mock` (staging) = made-up numbers from a fixture and ONE small cookie for the number "picked": nothing is bought or rented; `on` = C1's routes (lib/api/numbers.ts), which are
 * not live yet (C1 builds the buying side only after a read-only probe of the phone company's account). Every input is checked again here (the browser is not trusted); only the Owner claims (the action checks the role).
 */
export const COOKIE = "sme_phone_picker_mock";
const PAGE = 20;
type Kept = { number: string; type: NumberType; at: number };
const parseKept = (v: unknown): Kept | null => {
  const x = v as Partial<Kept> | null;
  return x && isNumber(x.number) && isType(x.type) && typeof x.at === "number" ? { number: x.number, type: x.type, at: x.at } : null;
};

/** The made-up numbers for a type and the digits they start with: a mobile number starts with 6 to 9; a landline is a city code (40, 80, 44...) and eight digits. Deterministic, so a test can name them. */
export function fixtureNumbers(type: NumberType, prefix: string, page: number): { numbers: PickNumber[]; more: boolean } {
  const lead = type === "mobile" ? "9429" : "4012";
  if (type === "mobile" && prefix !== "" && !/^[6-9]/.test(prefix)) return { numbers: [], more: false };
  if (type === "landline" && prefix !== "" && !/^[2-8]/.test(prefix)) return { numbers: [], more: false };
  if (prefix === "000" || prefix.startsWith("0")) return { numbers: [], more: false };
  const start = (prefix || lead).slice(0, 6);
  const total = 45;
  const out: PickNumber[] = [];
  for (let i = (page - 1) * PAGE; i < Math.min(page * PAGE, total); i += 1) {
    const rest = String(492465 + i * 7).padStart(10 - start.length, "0").slice(-(10 - start.length));
    const number = `+91${start}${rest}`;
    out.push({ number, display: displayNumber(number), type });
  }
  return { numbers: out, more: page * PAGE < total };
}

export const pickerMode = phonePicker;

export async function searchNumbers(token: string, tenantId: string, type: unknown, prefix: unknown, page: unknown): Promise<SearchResult> {
  const mode = phonePicker();
  const p = typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 50 ? page : 1;
  if (mode === "off" || !isType(type) || !isPrefix(prefix)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, null);
    if (kept) return { ok: false, error: "unavailable", reason: "already_has_number" };
    return { ok: true, ...fixtureNumbers(type, prefix, p), page: p };
  }
  try {
    return { ok: true, ...(await listAvailable(token, tenantId, type, prefix, p)) };
  } catch (error) {
    return refused(error);
  }
}

export async function claimNumber(token: string, tenantId: string, number: unknown, type: unknown): Promise<ClaimResult> {
  const mode = phonePicker();
  if (mode === "off" || !isNumber(number) || !isType(type)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    if (await readJar(COOKIE, parseKept, null)) return { ok: false, error: "unavailable", reason: "already_has_number" };
    const shown = fixtureNumbers(type, "", 1).numbers.concat(fixtureNumbers(type, number.slice(3, 6), 1).numbers);
    if (!shown.some((n) => n.number === number)) return { ok: false, error: "taken" };
    if (!(await writeJar(COOKIE, { number, type, at: Date.now() }))) return { ok: false, error: "down" };
    return { ok: true, number: { number, display: displayNumber(number), type, state: "getting_ready", label: null } };
  }
  try {
    return { ok: true, number: await apiClaim(token, tenantId, number, type) };
  } catch (error) {
    return refused(error);
  }
}

/** The Owner ticked "How you will use this number": the acceptance is stored (before the purchase). The test screen keeps nothing. */
export async function acceptUsageStep(token: string, tenantId: string): Promise<Refusal | { ok: true }> {
  const mode = phonePicker();
  if (mode === "off") return { ok: false, error: "invalid" };
  if (mode === "mock") return { ok: true };
  try {
    await acceptUsage(token, tenantId);
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

/** The workspace's number (the first one), or null. In the test screen it is "getting ready" for a minute, then ready. */
export async function readOwn(token: string, tenantId: string): Promise<OwnNumber | null> {
  const mode = phonePicker();
  if (mode === "off") return null;
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, null);
    if (!kept) return null;
    // with the business's own account (KYC_PER_CLIENT) a bought number is not active until the business is verified (C1: buy first, verify after)
    const verified = kycPerClient() === "off" || (await (await import("@/lib/phone-kyc/source")).readStatus(token, tenantId))?.state === "verified";
    return { number: kept.number, display: displayNumber(kept.number), type: kept.type, state: Date.now() - kept.at < 60_000 ? "getting_ready" : verified ? "ready" : "kyc_pending", label: null };
  }
  try {
    return (await listOwn(token, tenantId))[0] ?? null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/**
 * The workspace's number for the page that has no picker (PHONE_PICKER off, VoiceLink only): a read of `GET /numbers`; where the API does not have it yet or fails, null (the page then says "We set up your number for you"). Never throws except for a lost session.
 */
export async function readNumber(token: string, tenantId: string): Promise<OwnNumber | null> {
  try {
    return (await listOwn(token, tenantId))[0] ?? null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** Test screen only: give the number back (so the picker can be tried again). */
export async function resetMock(): Promise<void> {
  if (phonePicker() === "mock") await clearJar(COOKIE);
}

function refused(error: unknown): Refusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return { ok: false, error: error.code === "step_up_required" ? "step_up" : "forbidden" };
    if (error.status === 422) return { ok: false, error: "invalid" };
    if (error.status === 409) return error.code === "number_taken" ? { ok: false, error: "taken" } : { ok: false, error: "unavailable", reason: reasonOf(error) };
  }
  return { ok: false, error: "down" };
}
