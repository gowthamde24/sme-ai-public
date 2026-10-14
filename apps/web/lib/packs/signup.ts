import { signupPacks, textIn } from "./registry";
import type { Accent } from "./types";

/** What a sign-up card needs (plain, in one language). */
export type SignupCard = { id: string; name: string; tagline: string; icon: "fabric" | "block" | "cap"; accent: Accent };

export function signupCards(lang: string): SignupCard[] {
  return signupPacks().map((p) => ({ id: p.id, name: textIn(p.name, lang), tagline: textIn(p.tagline, lang), icon: p.signup.icon, accent: p.signup.accent }));
}

/** The pack id out of an address or a cookie, only if a person may pick it at sign-up; anything else is null (never trusted, never echoed). */
export function parseSignupPack(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && signupPacks().some((p) => p.id === v) ? v : null;
}

/** The name a new business gets until the owner is asked (the first step of the checklist), in the person's language. */
export function defaultBusinessName(id: string, lang: string): string {
  const p = signupPacks().find((x) => x.id === id);
  return p ? textIn(p.business_name_default, lang) : "My business";
}

/** The browser keeps the kind of business for the minutes Google or Facebook take (they cannot carry it back); `/setup` reads it. A convenience cookie, not an authority: the pack is checked again where it is used. */
export const SIGNUP_PACK_COOKIE = "s19_signup_pack";
export const SOCIAL_PROVIDERS = ["google", "facebook"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
