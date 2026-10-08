import { Bricolage_Grotesque, Noto_Sans_Devanagari, Noto_Sans_Kannada, Noto_Sans_Telugu, Plus_Jakarta_Sans } from "next/font/google";

/**
 * Design v2 fonts, through next/font/google like the root layout's Geist (self-hosted at run time; the build fetches
 * them, as it already does for Geist). Loaded only where V2Root is used. The three Indic fonts are not preloaded and are
 * declared per script, so a visitor who never sees that script does not download it. The CSS variables are consumed
 * by tokens.css (--v2-font-*-stack).
 */
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--v2-font-sans", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--v2-font-display", display: "swap" });
const telugu = Noto_Sans_Telugu({ subsets: ["telugu"], variable: "--v2-font-telugu", display: "swap", preload: false });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--v2-font-devanagari", display: "swap", preload: false });
const kannada = Noto_Sans_Kannada({ subsets: ["kannada"], variable: "--v2-font-kannada", display: "swap", preload: false });

const INDIC = { te: telugu, hi: devanagari, kn: kannada } as const;

/**
 * The font variables a page puts on its wrapper. Latin sans and display always; of the three Indic fonts only the one
 * for the page's language (a Telugu page downloads Telugu, an English page none: the other scripts' names, shown in the
 * language list, use the system's own font for that script). Without a language, all three. A font whose variable is
 * not on the page is never requested (an unset variable falls back to system-ui in tokens.css).
 */
export function v2FontClassName(lang?: string): string {
  const indic = lang === undefined ? [telugu, devanagari, kannada] : lang in INDIC ? [INDIC[lang as keyof typeof INDIC]] : [];
  return [sans, display, ...indic].map((f) => f.variable).join(" ");
}
