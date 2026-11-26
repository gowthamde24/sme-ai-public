import { Gauge } from "lucide-react";
import Link from "next/link";

import { JsonLd, faqLd } from "@/components/v2/site/JsonLd";
import { MinutesBilled, PlanCompare } from "@/components/v2/site/PlanDetails";
import { PublicPlanCards } from "@/components/v2/site/PublicPlans";
import { CtaBand, FaqList, Section } from "@/components/v2/site/sections";
import { btnPrimary, btnSecondary, card, container, lead } from "@/components/v2/site/ui";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { SiteLang } from "@/i18n/lang";
import { earlyAccess } from "@/lib/screens/flag";
import { startEntry } from "@/lib/site/entry";
import { planVars } from "@/lib/site/plans";
import { sitePath } from "@/lib/site/paths";

/**
 * Pricing (jobs CM, CX; the three paid plans since 19 Nov 2026): early access is free, so the page opens with the "join early access" card; then Pay as you go, Pro (recommended) and Business with their prices, "+ 18% GST", what every
 * plan includes and where the plans cross (components/v2/site/PublicPlans.tsx; the numbers are lib/site/plans.ts), all worded "With paid plans (from February 2027)"; the founding offer, done-for-you set-up, how fair use works and six
 * questions. The old two kinds of plans (Lead Desk plans, Workforce plans) and the per-business "what each plan fits" cards are gone: their plan names no longer exist.
 */
export function PricingPage({ t, lang }: { t: SiteT; lang: SiteLang }) {
  const start = startEntry(t, lang, t("h2.nav.early"));
  const vars = planVars();
  const faq = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({ q: t(`price.faq.${n}.q`, vars), a: t(`price.faq.${n}.a`, vars) }));
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("price.title")}
        </h1>
        <p className={lead}>{t("price.sub")}</p>
        <p role="note" className="mt-4 max-w-3xl rounded-lg border border-line bg-surface-2 px-4 py-3 text-base">
          {earlyAccess() ? t("price.early") : t("price.billing")}
        </p>
      </section>

      <section aria-label={t("price.title")} className={`${container} pb-10`}>
        <ul className="grid gap-4" data-part="trial-plan">
          <li className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`} data-plan="trial">
            <div>
              <h2 className="text-xl font-semibold">{t("price.trial.t")}</h2>
              <p className="mt-2 max-w-3xl text-base text-muted">{t("price.trial.d")}</p>
            </div>
            <Link href={start.href} className={`${btnPrimary} shrink-0 max-sm:w-full`}>
              {start.label}
            </Link>
          </li>
        </ul>

        <div className="mt-10">
          <h2 className="font-display text-2xl font-bold">{t("ld.plans.ld.t")}</h2>
          <div className="mt-4">
            <PublicPlanCards t={t} start={{ href: start.href, label: t("h3.cta") }} />
          </div>
        </div>

        <PlanCompare t={t} />
        <MinutesBilled t={t} lang={lang} />

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <article className={card} data-part="founding">
            <h2 className="text-xl font-semibold">{t("price.founding.t")}</h2>
            <p className="mt-2 text-base text-muted">{t("price.founding.d")}</p>
            <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={`${btnSecondary} mt-4`}>
              {t("nav.contact")}
            </Link>
          </article>
          <article className={card} data-part="done-for-you">
            <h2 className="text-xl font-semibold">{t("price.dfy.t")}</h2>
            <p className="mt-2 font-display text-xl font-bold">{t("price.soon")}</p>
            <p className="mt-2 text-base text-muted">{t("price.dfy.d")}</p>
          </article>
        </div>
      </section>

      <Section id="fair" title={t("price.fair.t")} tone="soft" narrow>
        <ul className="flex flex-col gap-3">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className={`${card} flex items-start gap-3`}>
              <Gauge className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
              <p className="text-base">{t(`price.fair.${n}`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("price.terms.4")}</p>
      </Section>

      <Section id="faq" title={t("faq.title")} narrow tone="soft">
        <FaqList items={faq} />
      </Section>
      <CtaBand t={t} lang={lang} />
      <JsonLd data={faqLd(faq.map((f) => ({ q: fillPlain(f.q), a: fillPlain(f.a) })))} />
    </>
  );
}
