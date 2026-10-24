import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { HERO_WIDTHS } from "@/components/v2/app/owl/owl-files";
import { JsonLd } from "@/components/v2/site/JsonLd";
import { BuiltFor, CallsSection, FinalCta, HowSection, LanguagesSection, PricingBox } from "@/components/v2/site/HomeSections";
import { SiteOwl } from "@/components/v2/site/SiteOwl";
import { btnPrimary, container } from "@/components/v2/site/ui";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { sitePath } from "@/lib/site/paths";

const badge = "inline-flex items-center text-sm font-semibold text-muted";

/**
 * The home page (job CX, from the approved design): the hero with the one owl of the page (Agent OWL), the business types it is built for (three plain cards), the six steps (animated, still with reduced motion), the dark
 * band of sample chats in the four languages, the phone line (what is available and what is coming), the trial box (no price anywhere: the plans are announced later), and the last call to action. Every word is a string
 * of i18n/strings/site.json or a field of a business type's landing.json; the two animated blocks are the only client code.
 */
export function HomePage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className={`${container} flex flex-wrap items-center gap-10 pb-10 pt-10 sm:pb-12 sm:pt-16`}>
        <div className="flex min-w-0 flex-[1_1_540px] flex-col items-start gap-5">
          <p className="inline-flex rounded-full bg-brand-bg px-3.5 py-1.5 text-sm font-bold text-brand-text">{t("hero.eyebrow")}</p>
          <h1 id="h1" className="font-display text-[2.5rem] font-extrabold leading-[1.04] tracking-tight [text-wrap:balance] sm:text-5xl lg:text-6xl">
            {t("hero.h1")}
          </h1>
          <p className="max-w-[34em] text-lg leading-relaxed text-muted sm:text-xl">{t("hero.sub")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/signup" className={`${btnPrimary} font-extrabold max-sm:w-full`}>
              {t("hero.cta")}
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href="#how" className="inline-flex min-h-14 items-center justify-center rounded-lg border-[1.5px] border-edge px-5 text-base font-bold text-ink hover:bg-surface-2 max-sm:w-full">
              {t("hero.secondary")}
            </Link>
          </div>
          <p className="flex flex-wrap gap-x-5 gap-y-2" data-part="badges">
            <span className={badge}>{t("hero.badge.channels")}</span>
            <span className={badge}>{t("hero.badge.langs")}</span>
            <span className={badge}>{t("hero.badge.evening")}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-[0_1_380px] justify-center">
          <SiteOwl agent="main" px={240} smPx={340} widths={HERO_WIDTHS} priority className="size-60 sm:size-[340px]" />
          <span className="sr-only">{t("owl.name.main")}, {t("hero.owl.mood")}</span>
        </div>
      </section>
      <BuiltFor t={t} lang={lang} />
      <HowSection t={t} />
      <LanguagesSection t={t} />
      <CallsSection t={t} />
      <PricingBox t={t} lang={lang} />
      <FinalCta t={t} lang={lang} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: BRAND_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: PUBLIC_URL + sitePath(lang, { kind: "home" }),
          description: fillPlain(t("meta.description")),
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
        }}
      />
    </>
  );
}
