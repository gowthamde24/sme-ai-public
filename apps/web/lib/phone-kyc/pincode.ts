import { kycPerClient } from "@/lib/screens/flag";

import { pinProblem, stateFromPostal } from "./rules";

/**
 * The PIN code lookup of the verification form (owner, 26 Nov 2026): when the 6 digits are complete the state and the city are filled in, and the person can correct them. VoiceLink only accepts a city as its own list spells it
 * ("Ananthapuramu", not "Anantapur"), which is how a post office writes it, so the city is the district of the first post office of the PIN. The test screen (KYC_PER_CLIENT=mock) uses a small table here and never asks the network.
 * Live: the public India Post directory (api.postalpincode.in), asked from THIS server only, with the PIN and nothing else (no name, no workspace, no token); a slow or unreadable answer is "not found" and the person types the two fields.
 * SERVER ONLY.
 */
export type PinFound = { state: string | null; city: string | null };
const MOCK: Readonly<Record<string, PinFound>> = {
  "515001": { state: "Andhra Pradesh", city: "Ananthapuramu" },
  "500001": { state: "Telangana", city: "Hyderabad" },
  "560001": { state: "Karnataka", city: "Bengaluru" },
  "400001": { state: "Maharashtra", city: "Mumbai" },
  "600001": { state: "Tamil Nadu", city: "Chennai" },
  "110001": { state: "Delhi", city: "New Delhi" },
};
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The answer of the directory: `[{Status: "Success", PostOffice: [{District, State, ...}]}]`. Anything else is null. */
export function parsePostal(json: unknown): PinFound | null {
  const first = Array.isArray(json) ? json[0] : null;
  if (!rec(first) || first.Status !== "Success" || !Array.isArray(first.PostOffice)) return null;
  const office = first.PostOffice.find(rec);
  if (!office) return null;
  const district = typeof office.District === "string" ? office.District.trim().slice(0, 60) : "";
  const state = typeof office.State === "string" ? stateFromPostal(office.State) : null;
  return district || state ? { state, city: district || null } : null;
}

export async function lookupPin(pin: unknown): Promise<PinFound | null> {
  if (typeof pin !== "string" || pinProblem(pin) !== null || kycPerClient() === "off") return null;
  const p = pin.trim();
  if (kycPerClient() === "mock") return MOCK[p] ?? null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${p}`, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    return res.ok ? parsePostal(await res.json()) : null;
  } catch {
    return null;
  }
}
