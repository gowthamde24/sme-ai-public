import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";

import { THEME_COOKIE, readTheme } from "@/i18n/preferences";

import "./globals.css";

// A nonce-based CSP (proxy.ts) needs every page rendered per request: a prerendered page has no nonce for its scripts.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SME AI Revenue Engine",
  description: "An AI workforce for SMEs.",
};

/**
 * `data-theme` on <html> is the theme bridge of the workspace redesign (docs/plans/workspace-v2-redesign-plan.md, 2.9): the choice made with the
 * v2 theme button (cookie `sme_theme`) also reaches the screens that are not yet in the v2 look, through two blocks at the end of globals.css.
 * No choice means no attribute: everything follows the system, as before. Removed in the clean-up batch.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
