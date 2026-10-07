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

export const v2FontClassName = [sans, display, telugu, devanagari, kannada].map((f) => f.variable).join(" ");
