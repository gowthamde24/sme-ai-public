import login from "@/i18n/strings/login.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { cookies } from "next/headers";

import { LANG_COOKIE, readLang } from "@/i18n/preferences";
import { dictFor, namedDict } from "@/i18n/strings";

/**
 * The CHROME words of the sign-in and account screens: the frame around the forms (skip link, language and theme
 * controls, the way back, the side panel). Nothing else from `login.json` is used on purpose: the form words, headings,
 * hints and messages of the real screens stay as they are today (Stage 3, owner decision 1). The other keys of that file
 * were written for design-lab's sign-in simulator and either differ from the real words, which tests and e2e/auth.mjs
 * pin, or say things that are not true of the product (docs/plans/port-design-v2-stage3-plan.md, section 4).
 * SERVER ONLY, like landing.ts: a client component must not import this file; a test enforces it.
 */
export const AUTH_CHROME_KEYS = ["skip", "lang.label", "theme.toDark", "theme.toLight", "home", "side.title", "side.d"] as const;
export type AuthKey = (typeof AUTH_CHROME_KEYS)[number];
export type AuthDict = Record<AuthKey, string>;
export type AuthT = (key: AuthKey, vars?: Vars) => string;

const cache = new Map<string, AuthDict>();

export function authDict(lang: Lang): AuthDict {
  return namedDict<AuthDict>(cache, lang, () => {
    const all = dictFor(login, lang) as Record<string, string>;
    return Object.fromEntries(AUTH_CHROME_KEYS.map((k) => [k, all[k]]));
  });
}

export function authT(lang: Lang): AuthT {
  const dict = authDict(lang);
  return (key, vars) => fill(dict[key], vars);
}

/**
 * The words of the sign-in, reset-password and code screens themselves (the shop owner's first login, in his own language; owner, 9 Nov 2026). English is the words the screens always had (tests and e2e/auth.mjs pin them);
 * Telugu, Kannada and Hindi are drafts for a native reader. The consent line under the form ("By continuing, you agree to the Terms ...") is not here: it stays English until a person has reviewed it.
 */
export const FORM_KEYS = [
  "form.signin.title", "form.email", "form.password", "form.signin.submit", "form.forgot", "form.google",
  "form.notice.link", "form.notice.reset", "form.notice.provider", "form.notice.everywhere", "form.notice.nosignup",
  "form.err.invalid", "form.err.check", "form.err.confirm", "form.err.wrong",
  "form.mfa.title", "form.mfa.lead", "form.mfa.label", "form.mfa.verify", "form.mfa.checking", "form.mfa.signout", "form.mfa.err", "form.mfa.wrong",
  "form.forgot.title", "form.forgot.lead", "form.forgot.send", "form.forgot.sending", "form.forgot.back", "form.forgot.err", "form.forgot.sent",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];
export type FormWords = Record<FormKey, string>;
const formCache = new Map<string, FormWords>();
export function formWords(lang: Lang): FormWords {
  return namedDict<FormWords>(formCache, lang, () => {
    const all = dictFor(login, lang) as Record<string, string>;
    return Object.fromEntries(FORM_KEYS.map((k) => [k, all[k]]));
  });
}
/** The language of the person on a sign-in screen or in its action: the `sme_lang` cookie, English when there is none (or outside a request). Never throws. */
export async function authLang(): Promise<Lang> {
  try {
    return readLang((await cookies()).get(LANG_COOKIE)?.value);
  } catch {
    return "en";
  }
}
