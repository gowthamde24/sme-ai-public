import type { ReactNode } from "react";

import { SiteFooter } from "@/components/v2/site/SiteFooter";
import { SiteHeader } from "@/components/v2/site/SiteHeader";
import { V2Root } from "@/components/v2/V2Root";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";
import type { SiteTarget } from "@/lib/site/paths";

/**
 * The frame of every public page (job CM): skip link, header, the machine-translation note for te/hi/kn, the page in `<main id="main">`, the footer. A pure server component: it takes the language and the (optional)
 * theme, so a test renders every page in every language without Next's request APIs; the route files read the theme cookie.
 */
export function SiteShell({ lang, theme, t, target, children }: { lang: Lang; theme?: Theme; t: SiteT; target: SiteTarget; children: ReactNode }) {
  return (
    <V2Root theme={theme} lang={lang} className="min-h-screen">
      <div id="top" data-screen="landing" data-page={target.kind === "home" ? "home" : target.kind === "page" ? target.page : "business"}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal">
          {t("skip")}
        </a>
        <SiteHeader t={t} lang={lang} theme={theme} target={target} />
        {lang !== "en" ? (
          <p role="note" className="border-b border-line bg-surface-2 px-4 py-2 text-center text-sm text-muted">
            {t("draft.banner")}
          </p>
        ) : null}
        <main id="main">{children}</main>
        <SiteFooter t={t} lang={lang} target={target} />
      </div>
    </V2Root>
  );
}
