import type { Metadata } from "next";
import { cookies } from "next/headers";

import { THEME_COOKIE, readTheme } from "@/i18n/preferences";

import "./globals.css";

// The pages draw their own fonts (design/fonts.ts, through V2Root); no font is loaded here, so no page downloads one it does not use.
// A nonce-based CSP (proxy.ts) needs every page rendered per request: a prerendered page has no nonce for its scripts.
export const dynamic = "force-dynamic";

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
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
