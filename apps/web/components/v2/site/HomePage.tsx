import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { JsonLd } from "@/components/v2/site/JsonLd";
import { BuiltFor, FinalCta, HeroExample, HowSection, PlansSection, SourcesSection, TrustBand } from "@/components/v2/site/HomeSections";
import { hasWaitlist, WaitlistSection, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { btnPrimary, container } from "@/components/v2/site/ui";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { PUBLIC_URL } from "@/lib/seo/site";
import { startEntry } from "@/lib/site/entry";
import { websiteOnly } from "@/lib/site/mode";
import { sitePath } from "@/lib/site/paths";

const badge = "inline-flex items-center text-sm font-semibold text-muted";

/**
 * The home page (job DM, reworked for Lead Desk in night 4, F1): the hero (headline, the two buttons, the 2-minute aim and an example: a WhatsApp chat with a call card), the six steps of Lead Desk, where leads already come from (text chips),
 * the business it is made for (three deep cards and a row of industry chips), the plans in two kinds (Lead Desk plans, Workforce plans; no price), trust and the last call to action. Every word is a string of i18n/strings/site.json
 * (or a field of a business type's landing.json); the hero example is the only client code, and it stands still with "reduce motion". Every section below the hero is server markup.
 */
export function HomePage({ t, lang, waitlist }: { t: SiteT; lang: Lang; waitlist?: WaitlistAction }) {
  const start = startEntry(t, lang, t("hero.cta"), { hasForm: hasWaitlist(waitlist) });
  return (
    <>
      <section aria-labelledby="h1" className={`${container} flex flex-wrap items-center gap-12 pb-12 pt-10 sm:pb-16 sm:pt-16`}>
        <div className="flex min-w-0 flex-[1_1_460px] flex-col items-start gap-6">
          <p className="inline-flex rounded-full bg-brand-bg px-3.5 py-1.5 text-sm font-bold text-brand-text">{t("hero.eyebrow")}</p>
          <h1 id="h1" className="font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight [text-wrap:balance] sm:text-5xl lg:text-6xl">
            {t("hero.h1")}
          </h1>
          <p className="max-w-[34em] text-lg leading-relaxed text-muted sm:text-xl">{t("hero.sub")}</p>
          <p className="max-w-[34em] text-base font-semibold text-ink" data-part="aim">
            {t("ld.aim")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={start.href} className={`${btnPrimary} font-extrabold max-sm:w-full`}>
              {start.label}
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href="#how" className="inline-flex min-h-14 items-center justify-center rounded-lg border-[1.5px] border-edge px-5 text-base font-bold text-ink hover:bg-surface-2 max-sm:w-full">
              {t("hero.secondary")}
            </Link>
          </div>
          <p className="text-sm text-muted" data-part="trial-note">
            {websiteOnly() ? t("demo.note") : t("hero.note")}
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-2" data-part="badges">
            <span className={badge}>{t("hero.badge.channels")}</span>
            <span className={badge}>{t("hero.badge.langs")}</span>
            <span className={badge}>{t("hero.badge.evening")}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-[1_1_380px] justify-center">
          <HeroExample t={t} />
        </div>
      </section>
      <HowSection t={t} />
      <SourcesSection t={t} />
      <BuiltFor t={t} lang={lang} />
      <PlansSection t={t} lang={lang} />
      <TrustBand t={t} lang={lang} />
      <WaitlistSection t={t} lang={lang} action={waitlist} />
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
