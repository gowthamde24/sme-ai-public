import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";

/**
 * Design v2 fonts. The two Latin fonts come through next/font/google like the root layout's Geist (self-hosted at run time; the build fetches
 * them, as it already does for Geist). Loaded only where V2Root is used. The three Indic fonts are not preloaded and are
 * declared per script, so a visitor who never sees that script does not download it. The CSS variables are consumed
 * by tokens.css (--v2-font-*-stack).
 *
 * The Indic fonts are the files in design/indic-fonts (job CH): Google's own Noto Sans builds of each script with the weight axis cut to 400 to 700, the weights the app uses (normal, medium,
 * semibold, bold). Google's file covers 100 to 900, which no screen uses: Telugu is 67 KB instead of 124, Kannada 49 instead of 91, Hindi 85 instead of 121 (see make-indic-fonts.py there, and its OFL.txt).
 * Every letter and shaping rule of the script is kept, so joined letters still form; the `unicode-range` is Google's own for that script, so the browser asks for the file only when a page shows a letter of it.
 */
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--v2-font-sans", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--v2-font-display", display: "swap" });
// next/font reads each call at build time, so every loader is called, with plain values, and assigned to a const in this file (a helper function around localFont is refused by the build)
const telugu = localFont({
  src: [{ path: "./indic-fonts/NotoSansTelugu-400-700.woff2", weight: "400 700", style: "normal" }],
  variable: "--v2-font-telugu",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+951-952,U+964-965,U+B83,U+C00-C7F,U+1CD5-1CD6,U+1CD8,U+1CDA,U+1CF2,U+200C-200D,U+25CC" }],
});
const devanagari = localFont({
  src: [{ path: "./indic-fonts/NotoSansDevanagari-400-700.woff2", weight: "400 700", style: "normal" }],
  variable: "--v2-font-devanagari",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+900-97F,U+1CD0-1CF4,U+1CF7-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B0A" }],
});
const kannada = localFont({
  src: [{ path: "./indic-fonts/NotoSansKannada-400-700.woff2", weight: "400 700", style: "normal" }],
  variable: "--v2-font-kannada",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+951-952,U+964-965,U+B83,U+C80-CF3,U+1CD0,U+1CD2-1CD3,U+1CDA,U+1CF2,U+1CF4,U+200C-200D,U+20B9,U+25CC,U+A830-A835" }],
});

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
