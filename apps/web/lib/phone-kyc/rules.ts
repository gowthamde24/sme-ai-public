/**
 * The rules of the verification forms (owner, 26 Nov 2026: every field is mandatory). One module for the browser (the message under a field once it was touched, "Save and continue" off until all is valid) and for the server step that
 * checks again (lib/phone-kyc/source.ts); C1 mirrors them in the API. Pure. Each check answers null (fine) or a closed word the screen has a sentence for (`pick.kyc.e.<word>`).
 */
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

export type Problem = "gst_business" | "required" | "name" | "phone" | "address" | "city" | "state" | "pin" | "terms" | "pan" | "holder" | "gst" | "email" | "file_type" | "file_size" | "file_empty";

const letters = (s: string): number => (s.match(/\p{L}/gu) ?? []).length;
export const MIN_ADDRESS = 8;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

/** A name: at least two letters (digits and marks alone are not a name). */
export const nameProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : letters(v) < 2 || v.trim().length > 120 ? "name" : null);

/** An Indian mobile number as people type it ("98480 12345", "+91 98480-12345", "091 98480 12345") as its ten digits, or null. Starts with 6, 7, 8 or 9. */
export function mobileDigits(v: string): string | null {
  let d = v.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]+$/.test(d)) return null;
  d = d.replace(/^\+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? d : null;
}
export const phoneProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : mobileDigits(v) === null ? "phone" : null);

export const addressProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : v.trim().length < MIN_ADDRESS || v.trim().length > 300 ? "address" : null);
export const cityProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : letters(v) < 2 || v.trim().length > 60 ? "city" : null);
export const stateProblem = (v: string): Problem | null => (v === "" ? "required" : (INDIAN_STATES as readonly string[]).includes(v) ? null : "state");
/** Six digits, the first one 1 to 9. */
export const pinProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : /^[1-9][0-9]{5}$/.test(v.trim()) ? null : "pin");
export const termsProblem = (v: boolean): Problem | null => (v ? null : "terms");

/** PAN: five letters, four digits, one letter (AAAAA9999A); typed in any case. */
export const panProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(v.trim()) ? null : "pan");
/** GSTIN (a Business only): 15 characters, the two digits of the state, the PAN, one entity character, Z, one check character. */
export const gstProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : /^(0[1-9]|[12][0-9]|3[0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/.test(v.trim()) ? null : "gst");
export const holderProblem = (v: string): Problem | null => (v.trim() === "" ? "required" : letters(v) < 2 ? "holder" : null);
export const emailProblem = (v: string | null): Problem | null => (!v || v.trim() === "" ? "required" : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "email");
/** A document: a photo (JPEG, PNG) or a PDF, not empty, at most 10 MB. */
export const fileProblem = (f: { type: string; size: number } | null): Problem | null => (f === null ? "required" : !(FILE_TYPES as readonly string[]).includes(f.type) ? "file_type" : f.size <= 0 ? "file_empty" : f.size > MAX_FILE_BYTES ? "file_size" : null);

export type DetailsInput = { businessName: string; fullName: string; phone: string; billingAddress: string; city: string; state: string; pincode: string; terms: boolean };
/** Every problem of the details form by field (empty when all is fine). `business` adds the business name. */
export function detailsProblems(v: DetailsInput, business: boolean): Partial<Record<keyof DetailsInput, Problem>> {
  const out: Partial<Record<keyof DetailsInput, Problem>> = {};
  const set = (k: keyof DetailsInput, p: Problem | null) => void (p && (out[k] = p));
  if (business) set("businessName", v.businessName.trim().length < 2 ? (v.businessName.trim() === "" ? "required" : "name") : null);
  set("fullName", nameProblem(v.fullName));
  set("phone", phoneProblem(v.phone));
  set("billingAddress", addressProblem(v.billingAddress));
  set("city", cityProblem(v.city));
  set("state", stateProblem(v.state));
  set("pincode", pinProblem(v.pincode));
  set("terms", termsProblem(v.terms));
  return out;
}

/** The API's closed word for a bad field (business-kyc.md) as the sentence of the same field here, so the server and the screen say the same thing. A word this screen does not know is "required". */
export const REASON_PROBLEM: Readonly<Record<string, Problem>> = {
  account_type_required: "required", name_required: "name", business_name_required: "name", mobile_invalid: "phone", address_required: "address", city_required: "city", state_invalid: "state", pincode_invalid: "pin",
  terms_required: "terms", pan_invalid: "pan", gstin_invalid: "gst", gstin_business_only: "gst_business", document_type_invalid: "required", file_type_invalid: "file_type",
};
export const reasonProblem = (word: string): Problem => REASON_PROBLEM[word] ?? "required";
/** The form field (of the details form) each API field name belongs to. */
export const API_FIELD: Readonly<Record<string, keyof DetailsInput>> = { full_name: "fullName", business_name: "businessName", phone: "phone", billing_address: "billingAddress", city: "city", state: "state", pincode: "pincode", accept_terms: "terms" };
