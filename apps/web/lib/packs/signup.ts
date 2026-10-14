import { textIn } from "./text";
import type { PackSummary } from "./types";

/** What a sign-up card needs (plain, in one language). Built from `GET /v1/packs`: the web keeps no list of business types. */
export type SignupCard = { id: string; name: string; tagline: string; accent: string; owlProp: string; validated: boolean };

export function signupCards(packs: readonly PackSummary[], lang: string): SignupCard[] {
  return packs.map((p) => ({ id: p.packId, name: textIn(p.names, lang), tagline: textIn(p.summary, lang), accent: p.accent, owlProp: p.owlProp, validated: p.validated }));
}

/** A pack code: lower case, digits and underscores (the API's own rule). */
export const PACK_CODE = /^[a-z][a-z0-9_]{1,30}$/;

/**
 * The pack code out of an address, a cookie or an account's metadata: only its SHAPE is checked here (nothing is echoed that is not a plain code). Whether a person may choose it is the API's answer, twice: the cards come from
 * `GET /v1/packs`, and the first-login setup refuses a code that is not selectable (422 `business_type_unavailable`).
 */
export function parseSignupPack(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && PACK_CODE.test(v) ? v : null;
}

/** The code of a card the list offers, else null. */
export function pickSignupPack(packs: readonly PackSummary[], value: unknown): string | null {
  const code = parseSignupPack(value);
  return code !== null && packs.some((p) => p.packId === code) ? code : null;
}

/** The name a new business gets until the checklist asks the real one (the e-mail way carries it with the account; the database names a social account's business the same). */
export const DEFAULT_BUSINESS_NAME = "My business";

/** The browser keeps the kind of business for the minutes Google or Facebook take (they cannot carry it back); `/setup` reads it. A convenience cookie, not an authority: the pack is checked again where it is used. */
export const SIGNUP_PACK_COOKIE = "s19_signup_pack";
export const SOCIAL_PROVIDERS = ["google", "facebook"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
