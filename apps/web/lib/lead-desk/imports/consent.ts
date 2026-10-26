import { BASES, type Basis, type Consent } from "./types";

/**
 * The four consent facts as the screens keep them while they are typed (night 4): `on` is the checkbox. `consentOf` is the value that goes to the server: null when the box is off, "incomplete" while a fact is missing,
 * else the whole confirmation. The server checks it again (parseConsent). Pure, client-safe.
 */
export type ConsentState = { on: boolean; list_name: string; purpose: string; basis: Basis; how_collected: string };
export const emptyConsent = (): ConsentState => ({ on: false, list_name: "", purpose: "", basis: BASES[0], how_collected: "" });

export function consentOf(s: ConsentState): Consent | null | "incomplete" {
  if (!s.on) return null;
  const list_name = s.list_name.trim();
  const purpose = s.purpose.trim();
  const how_collected = s.how_collected.trim();
  if (!list_name || !purpose || !how_collected || list_name.length > 120 || purpose.length > 300 || how_collected.length > 300) return "incomplete";
  return { confirmed: true, list_name, purpose, basis: s.basis, how_collected };
}
