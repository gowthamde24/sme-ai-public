import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { CookieConsent } from "@/components/v2/legal/CookieConsent";
import { COOKIE_WORD_KEYS } from "@/components/v2/legal/cookie-words";
import { BRAND_NAME, SHORT_NAME } from "@/design/brand";
import { ServiceWorker } from "@/components/v2/pwa/ServiceWorker";
import { V2Root } from "@/components/v2/V2Root";
import { legalT } from "@/i18n/legal";
import { LANG_COOKIE, THEME_COOKIE, readLang, readTheme } from "@/i18n/preferences";
import { CONSENT_COOKIE, readConsent } from "@/lib/consent/consent";
import { PUBLIC_URL } from "@/lib/seo/site";
import { websiteOnly } from "@/lib/site/mode";

import "./globals.css";

// The pages draw their own fonts (design/fonts.ts, through V2Root); no font is loaded here, so no page downloads one it does not use.
// A nonce-based CSP (proxy.ts) needs every page rendered per request: a prerendered page has no nonce for its scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_URL), // the share pictures and canonical links are absolute (job BS)
  title: BRAND_NAME,
  description: "An AI workforce for SMEs.",
  // installable on a phone (job BL): the manifest is app/manifest.ts; the circle icons are in public/icons
  applicationName: SHORT_NAME,
  appleWebApp: { capable: true, title: SHORT_NAME, statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/mark.svg", type: "image/svg+xml" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

// the colour of the phone's address bar and the installed app's title bar: the v2 background, light and dark (design/tokens.css)
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#17161a" },
  ],
};

/**
 * `data-theme` on <html> is the theme bridge of the workspace redesign (docs/plans/workspace-v2-redesign-plan.md, 2.9): the choice made with the
 * v2 theme button (cookie `sme_theme`) also reaches the screens that are not yet in the v2 look, through two blocks at the end of globals.css.
 * No choice means no attribute: everything follows the system, as before. Removed in the clean-up batch.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar = await cookies();
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const lang = readLang(jar.get(LANG_COOKIE)?.value);
  const t = legalT(lang);
  // the cookie notice (job BH): shown once on every page until the visitor answers; the server reads the answer from the sme_consent cookie, so it never flickers for someone who has answered
  return (
    <html lang="en" data-theme={theme}>
      <body>
        {children}
        {websiteOnly() ? null : <ServiceWorker lang={lang} />}
        <V2Root theme={theme} lang={lang} className="sticky bottom-0 z-[70]">
          <CookieConsent initial={readConsent(jar.get(CONSENT_COOKIE)?.value)} words={Object.fromEntries(COOKIE_WORD_KEYS.map((k) => [k, t(k)]))} />
        </V2Root>
      </body>
    </html>
  );
}
