import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { DOC_TYPES, fieldReasons, kycAadhaar, kycDetails, kycDocument, kycGst, kycPan, kycStart, kycSubmit, readKyc, refusalReason, type AccountType, type DocType, type KycDetails, type KycReason, type KycStatus } from "@/lib/api/business-kyc";
import { clearJar, readJar, writeJar } from "@/lib/mock/jar";
import { kycPerClient } from "@/lib/screens/flag";

import { FILE_TYPES as RULE_FILE_TYPES, MAX_FILE_BYTES as RULE_MAX_FILE_BYTES, addressProblem, cityProblem, gstProblem, holderProblem, mobileDigits, nameProblem, panProblem, pinProblem, stateProblem } from "./rules";

/**
 * Where "Verify your business" gets its status and does its steps (KYC_PER_CLIENT; C1's docs/contracts/business-kyc.md). `mock` = a made-up status kept in ONE small cookie of the browser (nothing is sent, no document leaves the page; the check "finishes" a minute
 * after it is sent); `1` = C1's `/phone-kyc/business` routes. Every input is checked again here (the browser is not trusted); only the Owner does a step (the action checks the role). A refusal is a closed word the screen puts in plain language: the API's own
 * sentences never reach the screen. PAN, GSTIN and the files pass through and are dropped: nothing here stores, logs or returns them.
 */
export const COOKIE = "sme_kyc_mock";
export const MAX_FILE_BYTES = RULE_MAX_FILE_BYTES;
export const FILE_TYPES = RULE_FILE_TYPES;

export type KycError = "invalid" | "forbidden" | "step_up" | "down" | "refused";
export type KycRefusal = { ok: false; error: KycError; reason?: KycReason; missing?: string[]; /** a `422 kyc_fields_invalid`: each bad field and its closed word */ fieldReasons?: Record<string, string> };
export type KycResult<T = KycStatus> = { ok: true; data: T } | KycRefusal;

const text = (v: unknown, min: number, max: number): string | null => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);

type Kept = { state: KycStatus["state"]; type: AccountType | null; pc: boolean; ac: boolean; gc: boolean; docs: DocType[]; at: number };
const NONE: Kept = { state: "not_started", type: null, pc: false, ac: false, gc: false, docs: [], at: 0 };
const parseKept = (v: unknown): Kept | null => {
  const x = v as Partial<Kept> | null;
  if (!x || typeof x !== "object" || typeof x.state !== "string" || typeof x.at !== "number" || !Array.isArray(x.docs)) return null;
  return { state: x.state, type: x.type === "individual" || x.type === "business" ? x.type : null, pc: x.pc === true, ac: x.ac === true, gc: x.gc === true, docs: x.docs.filter((d): d is DocType => (DOC_TYPES as readonly string[]).includes(d as string)), at: x.at };
};
const NAMES: Record<DocType, string> = { pan: "PAN Card", aadhaar: "Aadhaar", gst: "GST Certificate" };
function mockStatus(k: Kept): KycStatus {
  const state = k.state === "submitted" && Date.now() - k.at > 60_000 ? "verified" : k.state;
  const wants: DocType[] = k.type === "business" ? ["pan", "aadhaar", "gst"] : ["pan", "aadhaar"];
  const next = wants.find((d) => !k.docs.includes(d));
  return { state, accountType: k.type, step: state === "verified" || state === "submitted" ? "complete" : next ?? "complete", steps: Object.fromEntries(wants.map((d) => [d, k.docs.includes(d)])) as KycStatus["steps"], missing: [], reason: null };
}
const mock = (): boolean => kycPerClient() === "mock";
const keep = async (k: Kept): Promise<KycResult> => ((await writeJar(COOKIE, k)) ? { ok: true, data: mockStatus(k) } : { ok: false, error: "down" });

export function refused(error: unknown): KycRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return { ok: false, error: error.code === "mfa_required" || error.code === "step_up_required" ? "step_up" : "forbidden" };
    const fr = fieldReasons(error);
    if (fr) return { ok: false, error: "invalid", fieldReasons: fr };
    const r = refusalReason(error);
    if (r && (error.status === 422 || error.status === 409 || error.status === 503)) return { ok: false, error: r.reason === "unavailable" ? "down" : "refused", reason: r.reason };
  }
  return { ok: false, error: "down" };
}

/** Where the business's account stands; null when the part is not there (flag off, or the API answers 404). Never throws except for a lost session. */
export async function readStatus(token: string, tenantId: string): Promise<KycStatus | null> {
  if (kycPerClient() === "off") return null;
  if (mock()) return mockStatus(await readJar(COOKIE, parseKept, NONE));
  try {
    return await readKyc(token, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The business's own client is made once (its e-mail is the signed-in Owner's). Already made = the status as it is. */
export async function startAccount(token: string, tenantId: string, type: unknown): Promise<KycResult> {
  if (kycPerClient() === "off" || (type !== "individual" && type !== "business")) return { ok: false, error: "invalid" };
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    return k.state === "not_started" ? keep({ ...k, state: "created", type, at: Date.now() }) : { ok: true, data: mockStatus(k) };
  }
  try {
    return { ok: true, data: await kycStart(token, tenantId) };
  } catch (error) {
    return refused(error);
  }
}

export async function saveDetails(token: string, tenantId: string, input: Record<string, unknown>): Promise<KycResult> {
  const type = input.accountType;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  // every field is mandatory (owner, 26 Nov 2026): the same rules as the form (lib/phone-kyc/rules.ts), checked again here
  const digits = mobileDigits(str(input.phone));
  const businessName = text(input.businessName, 2, 120);
  const fullName = nameProblem(str(input.fullName)) === null ? str(input.fullName).trim() : null;
  const address = addressProblem(str(input.billingAddress)) === null ? str(input.billingAddress).trim() : null;
  const city = cityProblem(str(input.city)) === null ? str(input.city).trim() : null;
  const state = stateProblem(str(input.state)) === null ? str(input.state) : null;
  const pin = pinProblem(str(input.pincode)) === null ? str(input.pincode).trim() : null;
  if (kycPerClient() === "off" || (type !== "individual" && type !== "business") || !fullName || !digits || !address || !city || !state || !pin || input.acceptTerms !== true) return { ok: false, error: "invalid" };
  if (type === "business" && !businessName) return { ok: false, error: "invalid" };
  const phone = digits; // ten digits only: the phone service refuses a '+' (real probe, 25 Nov 2026)
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    if (k.state === "not_started") return { ok: false, error: "refused", reason: "not_started" };
    return keep({ ...k, state: k.state === "created" ? "in_progress" : k.state, type });
  }
  const d: KycDetails = { accountType: type, businessName: type === "business" ? businessName : null, fullName, phone, billingAddress: address, state, city, pincode: pin };
  try {
    return { ok: true, data: await kycDetails(token, tenantId, d) };
  } catch (error) {
    return refused(error);
  }
}

export async function checkPan(token: string, tenantId: string, panNumber: unknown, holderName: unknown): Promise<KycResult> {
  const name = typeof holderName === "string" && holderProblem(holderName) === null ? holderName.trim() : null;
  if (kycPerClient() === "off" || typeof panNumber !== "string" || panProblem(panNumber) !== null || !name) return { ok: false, error: "invalid" };
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    if (k.state !== "in_progress") return { ok: false, error: "refused", reason: "step_order" };
    if (name.toLowerCase() === "mismatch") return { ok: false, error: "refused", reason: "pan_mismatch" };
    return keep({ ...k, pc: true });
  }
  try {
    return { ok: true, data: await kycPan(token, tenantId, panNumber.trim().toUpperCase(), name) };
  } catch (error) {
    return refused(error);
  }
}

export async function checkGst(token: string, tenantId: string, gstNumber: unknown): Promise<KycResult> {
  if (kycPerClient() === "off" || typeof gstNumber !== "string" || gstProblem(gstNumber) !== null) return { ok: false, error: "invalid" };
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    if (k.state !== "in_progress" || k.type !== "business") return { ok: false, error: "refused", reason: "step_order" };
    return keep({ ...k, gc: true });
  }
  try {
    return { ok: true, data: await kycGst(token, tenantId, gstNumber.trim().toUpperCase()) };
  } catch (error) {
    return refused(error);
  }
}

/** The DigiLocker address, to open on the person's OWN phone (Aadhaar never touches us). */
export async function startAadhaar(token: string, tenantId: string): Promise<KycResult<{ url: string }>> {
  if (kycPerClient() === "off") return { ok: false, error: "invalid" };
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    if (k.state !== "in_progress") return { ok: false, error: "refused", reason: "step_order" };
    return (await writeJar(COOKIE, { ...k, ac: true })) ? { ok: true, data: { url: "https://digilocker.example.invalid/start?test=1" } } : { ok: false, error: "down" };
  }
  try {
    return { ok: true, data: { url: await kycAadhaar(token, tenantId) } };
  } catch (error) {
    return refused(error);
  }
}

/** A document of the business, passed through in memory and dropped (never stored, logged or returned). */
export async function sendDocument(token: string, tenantId: string, type: unknown, contentType: unknown, bytes: Uint8Array): Promise<KycResult> {
  if (kycPerClient() === "off" || typeof type !== "string" || !(DOC_TYPES as readonly string[]).includes(type) || typeof contentType !== "string" || !(FILE_TYPES as readonly string[]).includes(contentType)) return { ok: false, error: "invalid" };
  if (bytes.length === 0) return { ok: false, error: "refused", reason: "file_unreadable" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "refused", reason: "file_too_big" };
  const doc = type as DocType;
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    if (k.state !== "in_progress" || (doc === "pan" && !k.pc) || (doc === "aadhaar" && !k.ac) || (doc === "gst" && !k.gc)) return { ok: false, error: "refused", reason: "step_order" };
    return keep({ ...k, docs: [...new Set([...k.docs, doc])] });
  }
  try {
    return { ok: true, data: await kycDocument(token, tenantId, doc, contentType, Buffer.from(bytes).toString("base64")) };
  } catch (error) {
    return refused(error);
  }
}

export async function submitAll(token: string, tenantId: string): Promise<KycResult> {
  if (kycPerClient() === "off") return { ok: false, error: "invalid" };
  if (mock()) {
    const k = await readJar(COOKIE, parseKept, NONE);
    const need: DocType[] = k.type === "business" ? ["pan", "aadhaar", "gst"] : ["pan", "aadhaar"];
    const missing = need.filter((d) => !k.docs.includes(d)).map((d) => NAMES[d]);
    if (k.state !== "in_progress") return { ok: false, error: "refused", reason: "step_order" };
    if (missing.length > 0) return { ok: false, error: "refused", reason: "missing_documents", missing };
    return keep({ ...k, state: "submitted", at: Date.now() });
  }
  try {
    return { ok: true, data: await kycSubmit(token, tenantId) };
  } catch (error) {
    const r = refused(error);
    // `422 missing_documents`: the names are in the status that follows (the client keeps only closed extras)
    if (!r.ok && r.reason === "missing_documents") {
      try {
        return { ...r, missing: (await readKyc(token, tenantId)).missing };
      } catch {
        return r;
      }
    }
    return r;
  }
}

/** Test screen only: start again. */
export async function resetMock(): Promise<void> {
  if (mock()) await clearJar(COOKIE);
}
