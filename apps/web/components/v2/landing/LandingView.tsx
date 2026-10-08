import { Control } from "@/components/v2/landing/Control";
import { EarlyAccess } from "@/components/v2/landing/EarlyAccess";
import { Faq } from "@/components/v2/landing/Faq";
import { Footer } from "@/components/v2/landing/Footer";
import { Header } from "@/components/v2/landing/Header";
import { Hero } from "@/components/v2/landing/Hero";
import { How } from "@/components/v2/landing/How";
import { LanguagesSection } from "@/components/v2/landing/LanguagesSection";
import { Privacy } from "@/components/v2/landing/Privacy";
import { Problem } from "@/components/v2/landing/Problem";
import { TeamSection } from "@/components/v2/landing/TeamSection";
import { V2Root } from "@/components/v2/V2Root";
import { landingT } from "@/i18n/landing";
import type { Lang } from "@/i18n/lang";
import type { Theme } from "@/i18n/preferences";

/**
 * The whole public landing page as a pure component: it takes the language and the (optional) theme and returns the
 * markup, so it can be rendered in every language in a test without Next's request APIs. app/landing/page.tsx reads the
 * two preference cookies and passes them in.
 */
export function LandingView({ lang, theme }: { lang: Lang; theme?: Theme }) {
  const t = landingT(lang);
  return (
    <V2Root theme={theme} lang={lang} className="min-h-screen">
      <div id="top" data-screen="landing">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-charcoal focus:px-4 focus:py-3 focus:text-on-charcoal"
        >
          {t("skip")}
        </a>
        <Header t={t} lang={lang} theme={theme} />
        <main id="main">
          <Hero t={t} />
          <Problem t={t} />
          <How t={t} />
          <Control t={t} />
          <TeamSection t={t} />
          <LanguagesSection t={t} />
          <Privacy t={t} />
          <EarlyAccess labels={{ title: t("early.title"), body: t("early.body"), status: t("early.status"), nodata: t("early.nodata"), clicked: t("early.clicked") }} />
          <Faq t={t} />
        </main>
        <Footer t={t} />
      </div>
    </V2Root>
  );
}
