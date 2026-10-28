import login from "@/i18n/strings/login.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
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
