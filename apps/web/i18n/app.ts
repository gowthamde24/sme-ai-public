import app from "@/i18n/strings/app.json";

import { fill, type Vars } from "@/i18n/fill";
import type { Lang } from "@/i18n/lang";
import { dictFor, namedDict } from "@/i18n/strings";

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

const cache = new Map<string, AppDict>();

export function appDict(lang: Lang): AppDict {
  return namedDict<AppDict>(cache, lang, () => dictFor(app, lang));
}

export function appT(lang: Lang): AppT {
  const dict = appDict(lang);
  return (key, vars) => fill(dict[key], vars);
}

/**
 * The words the frame's own client parts read through `word(labels, key, english)`: the menu (`nav.`), the frame (`frame.`: plan, AI usage, account, workspace switcher), the bell (`notify.`), the offline and session
 * banners (`robust.`), the problem pages (`problem.`, `notfound.`) and the install hint (`pwa.`). ONLY these travel in every page's payload (job CF: it was every key not named in a deny-list, about 55 KB of
 * JSON, three quarters of it words of one screen or another). The words of a screen travel with that screen's own page (`wordsFor`, i18n/app-words.ts), and the Help guides and tips (`help.*`) are read on the server.
 * A client part that needs a word of another prefix takes it as a prop from its page; a test (i18n/app.test.ts) pins that every key the frame's parts look up is in this set.
 */
const FRAME_PREFIXES = ["frame.", "nav.", "notify.", "robust.", "problem.", "notfound.", "pwa."];

/** The words of the frame (a few hundred short words, in ONE language), as plain props for the client components. */
export function frameLabels(lang: Lang): Record<string, string> {
  return Object.fromEntries(Object.entries(appDict(lang)).filter(([key]) => FRAME_PREFIXES.some((p) => key.startsWith(p))));
}
