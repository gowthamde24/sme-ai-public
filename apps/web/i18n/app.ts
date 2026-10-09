import app from "@/i18n/strings/app.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor } from "@/i18n/strings";

/**
 * The words of the workspace FRAME (workspace redesign, language track L0): the menu groups and items, the top bar, the bottom bar and its list, the workspace
 * switcher, the account menu. NOT the words of the screens: those stay English until the language batches, and the strings no machine may translate
 * (money, what a customer receives, consent, privacy, safety statements, what was or was not saved: plan 5.4) are not in this store at all.
 * Every Telugu, Hindi and Kannada string is a machine DRAFT until a person who reads the language marks it reviewed.
 * SERVER ONLY, like landing.ts and auth.ts: a client component must not import this file (all four dictionaries would land in the browser bundle); the
 * server (AppFrame) resolves the words and passes them down as props. A test enforces it.
 */
export type AppKey = keyof typeof app;
export type AppDict = Record<AppKey, string>;
export type AppT = (key: AppKey, vars?: Vars) => string;

const cache: Partial<Record<Lang, AppDict>> = {};

export function appDict(lang: Lang): AppDict {
  return (cache[lang] ??= dictFor(app, lang) as AppDict);
}

export function appT(lang: Lang): AppT {
  const dict = appDict(lang);
  return (key, vars) => fill(dict[key], vars);
}

/** The whole dictionary as plain props for the client components of the frame (a few dozen short words, in ONE language). */
export function frameLabels(lang: Lang): Record<string, string> {
  return { ...appDict(lang) };
}
