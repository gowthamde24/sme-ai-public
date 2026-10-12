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

/**
 * The words the screens of the workspace (job BK) and the Help guides and tips (`help.*`, job BT: read on the server by the Help screens and the "?" tips) read through `wordsFor` (i18n/app-words.ts): they travel with their own page, so the frame does not carry them on every page.
 * Before this the frame shipped the whole store (about 240 KB in Telugu after job BK) in every page's payload.
 */
const SCREEN_PREFIXES = ["enq.", "orders.", "fu.", "ws.", "rev.", "ag.", "prv.", "qp.", "pl.", "it.", "acct.", "cont.", "cust.", "supp.", "prod.", "comp.", "sug.", "parts.", "int.", "help.", "report."];

/** The words of the frame and of the older screens that read the whole store (a few hundred short words, in ONE language), as plain props for the client components. */
export function frameLabels(lang: Lang): Record<string, string> {
  return Object.fromEntries(Object.entries(appDict(lang)).filter(([key]) => !SCREEN_PREFIXES.some((p) => key.startsWith(p))));
}
