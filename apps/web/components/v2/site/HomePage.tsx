import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { JsonLd, faqLd } from "@/components/v2/site/JsonLd";
import { CtaBand, FaqList, OwlTeam, PackCards, Section, Steps, TrustStrip } from "@/components/v2/site/sections";
import { SiteOwl } from "@/components/v2/site/SiteOwl";
import { btnPrimary, container, eyebrow, linkQuiet } from "@/components/v2/site/ui";
import { BRAND_NAME } from "@/design/brand";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { LOWEST_PLAN_RUPEES, PLANS, formatRupees } from "@/lib/site/plans";
import { sitePath } from "@/lib/site/paths";
import { SITE_URL } from "@/lib/seo/site";

const FAQ = [1, 2, 3, 4, 5, 6] as const;

/** The home page (job CM, blueprint section 7): hero with the owl, the business cards (the pack switcher), the owl team, three steps, the trust strip, a pricing teaser, the questions, and the one call to action. */
export function HomePage({ t, lang }: { t: SiteT; lang: Lang }) {
  const faq = FAQ.map((n) => ({ q: t(`faq.${n}.q`), a: t(`faq.${n}.a`) }));
  return (
    <>
      <section aria-labelledby="h1" className={`${container} grid items-center gap-8 pb-10 pt-6 sm:pt-10 lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:pb-16`}>
        <div>
          <p className={eyebrow}>{t("hero.eyebrow")}</p>
          <h1 id="h1" className="mt-2 max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl xl:text-6xl">
            {t("hero.h1")}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{t("hero.sub")}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/signup" className={`${btnPrimary} max-sm:min-h-12`}>
              {t("hero.cta")}
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href={sitePath(lang, { kind: "page", page: "how-it-works" })} className={linkQuiet}>
              {t("hero.secondary")}
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted">{t("hero.note")}</p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <SiteOwl agent="main" px={176} smPx={224} priority className="size-44 sm:size-56" />
          <span className="sr-only">{t("owl.name.main")}, {t("hero.owl.mood")}</span>
        </div>
      </section>

      <Section id="businesses" title={t("packs.title")} sub={t("packs.sub")}>
        <PackCards t={t} lang={lang} />
      </Section>
      <Section id="owls" title={t("owls.title")} sub={t("owls.sub")} tone="soft">
        <OwlTeam t={t} lang={lang} />
      </Section>
      <Section id="steps" title={t("steps.title")} sub={t("steps.sub")}>
        <Steps t={t} />
      </Section>
      <Section id="trust" title={t("trust.title")} tone="soft">
        <TrustStrip t={t} lang={lang} />
      </Section>
      <Section id="pricing" title={t("teaser.title")} sub={t("teaser.sub", { from: formatRupees(LOWEST_PLAN_RUPEES) })}>
        <Link href={sitePath(lang, { kind: "page", page: "pricing" })} className={btnPrimary}>
          {t("teaser.cta")}
        </Link>
      </Section>
      <Section id="faq" title={t("faq.title")} narrow>
        <FaqList items={faq} />
      </Section>
      <CtaBand t={t} />
      <JsonLd data={faqLd(faq.map((f) => ({ q: fillPlain(f.q), a: fillPlain(f.a) })))} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: BRAND_NAME,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: SITE_URL + sitePath(lang, { kind: "home" }),
          description: fillPlain(t("meta.description")),
          inLanguage: ["en-IN", "te-IN", "hi-IN", "kn-IN"],
          offers: [{ "@type": "Offer", name: "Free trial", price: 0, priceCurrency: "INR" }, ...PLANS.map((p) => ({ "@type": "Offer", name: p.id, price: p.rupees, priceCurrency: "INR" }))],
        }}
      />
    </>
  );
}
