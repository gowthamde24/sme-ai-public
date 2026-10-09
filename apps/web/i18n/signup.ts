import signup from "@/i18n/strings/signup.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor } from "@/i18n/strings";

/**
 * The words of the sign-up, check-your-email and first-login set-up screens (Job AC, batch C5). Telugu, Hindi and Kannada are machine DRAFTS; the strings about accepting terms
 * (a legal act) stay English until a person who reads the language has reviewed them (`humanOnly`). SERVER ONLY, like app.ts: a client component must not import this file
 * (all four dictionaries would land in the browser); the page resolves the words and passes the ones a form needs as props.
 */
export type SignupKey = keyof typeof signup;
export type SignupT = (key: SignupKey, vars?: Vars) => string;

const cache: Partial<Record<Lang, Record<SignupKey, string>>> = {};

export function signupDict(lang: Lang): Record<SignupKey, string> {
  return (cache[lang] ??= dictFor(signup as never, lang) as Record<SignupKey, string>);
}

export function signupT(lang: Lang): SignupT {
  const dict = signupDict(lang);
  return (key, vars) => fill(dict[key], vars);
}
