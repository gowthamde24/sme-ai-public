import { Check, Gauge } from "lucide-react";
import Link from "next/link";

import { JsonLd, faqLd } from "@/components/v2/site/JsonLd";
import { CtaBand, FaqList, Section } from "@/components/v2/site/sections";
import { btnPrimary, btnSecondary, card, chip, container, h2, lead, section } from "@/components/v2/site/ui";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { CATALOGUE } from "@/lib/plan/catalogue";
import { startEntry } from "@/lib/site/entry";
import { planLines } from "@/lib/site/home-plans";
import { leadDeskPlanName } from "@/lib/site/lead-desk";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/site/plans";
import { SITE_PACKS, say, textIn } from "@/lib/site/packs";
import { sitePath } from "@/lib/site/paths";

const NAME: Record<PlanId, "price.starter.t" | "price.growth.t" | "price.business.t"> = { starter: "price.starter.t", growth: "price.growth.t", business: "price.business.t" };

/**
 * Pricing (jobs CM, CX; two kinds of plans since night 4): the trial, the Lead Desk plans (Pay as you go, Lead Desk 300, Lead Desk 1,000: the calls plans of the plans data) and the Workforce plans (Starter, Growth and Business: Lead Desk + industry pack + lead finding + research) with what every plan includes, the founding offer, the done-for-you setup, how fair use works, and for each kind of business what each
 * plan fits. NO amount is shown anywhere: the owner decides the prices after usage tests, so each plan says "Pricing announced soon". No plan limit is stated because none is decided.
 */
export function PricingPage({ t, lang }: { t: SiteT; lang: Lang }) {
  const start = startEntry(t, lang, t("cta.start"));
  const faq = ([1, 2, 3] as const).map((n) => ({ q: t(`price.faq.${n}.q`), a: t(`price.faq.${n}.a`) }));
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("price.title")}
        </h1>
        <p className={lead}>{t("price.sub")}</p>
        <p role="note" className="mt-4 max-w-3xl rounded-lg border border-line bg-surface-2 px-4 py-3 text-base">
          {t("price.billing")}
        </p>
      </section>

      <section aria-label={t("price.title")} className={`${container} pb-10`}>
        <ul className="grid gap-4" data-part="trial-plan">
          <li className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`} data-plan="trial">
            <div>
              <h2 className="text-xl font-semibold">{t("price.trial.t")}</h2>
              <p className="mt-2 max-w-3xl text-base text-muted">{t("price.trial.d", { days: String(TRIAL_DAYS) })}</p>
            </div>
            <Link href={start.href} className={`${btnPrimary} shrink-0 max-sm:w-full`}>
              {start.label}
            </Link>
          </li>
        </ul>

        <div className="mt-10" data-plan-group="calls">
          <h2 className="font-display text-2xl font-bold">{t("ld.plans.ld.t")}</h2>
          <p className="mt-1 max-w-3xl text-base text-muted">{t("ld.plans.ld.d")}</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-3" data-part="plans" data-plan-kind="calls">
            {CATALOGUE.plans
              .filter((p) => p.kind === "calls")
              .map((p) => (
                <li key={p.id} className={`${card} flex flex-col`} data-plan={p.id}>
                  <h3 className="text-xl font-semibold">{leadDeskPlanName(p.id, p.name)}</h3>
                  <p className="mt-2 font-display text-xl font-bold" data-part="soon">
                    {t("price.soon")}
                  </p>
                  <ul className="mt-3 flex flex-col gap-1.5 text-base">
                    {planLines(p, (key, vars) => t(key as "hm.pl.f.ai", vars as Record<string, string>)).map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </div>

        <div className="mt-10" data-plan-group="main">
          <h2 className="font-display text-2xl font-bold">{t("ld.plans.wf.t")}</h2>
          <p className="mt-1 max-w-3xl text-base text-muted">{t("ld.plans.wf.d")}</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-3" data-part="plans" data-plan-kind="main">
            {PLANS.map((p) => (
              <li key={p.id} className={`${card} flex flex-col`} data-plan={p.id}>
                <h3 className="text-xl font-semibold">{t(NAME[p.id])}</h3>
                <p className="mt-2 font-display text-xl font-bold" data-part="soon">
                  {t("price.soon")}
                </p>
                <ul className="mt-3 flex flex-col gap-1.5 text-base">
                  {([1, 2, 3] as const).map((n) => (
                    <li key={n} className="flex items-start gap-2">
                      <Check className="mt-1 size-4 shrink-0 text-green-text" aria-hidden="true" />
                      {t(`price.terms.${n}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">{t("ld.plans.wf.note")}</p>
        </div>

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

      <section aria-labelledby="fits-h" className={`${section}`}>
        <div className={container}>
          <h2 id="fits-h" className={h2}>
            {t("price.examples.t")}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3" data-part="plan-fit">
            {SITE_PACKS.map((pack) => (
              <article key={pack.slug} className={card}>
                <h3 className="text-lg font-semibold">
                  <Link href={sitePath(lang, { kind: "pack", slug: pack.slug })} className="inline-flex min-h-11 items-center hover:underline">
                    {textIn(pack.names, lang)}
                  </Link>
                </h3>
                <dl className="mt-3 flex flex-col gap-3">
                  {PLANS.map((p) => (
                    <div key={p.id}>
                      <dt className="text-sm font-semibold text-muted">
                        <span className={chip}>{t(NAME[p.id])}</span>
                      </dt>
                      <dd className="mt-1 text-base">{say(pack.plan_fit[p.id], lang)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Section id="faq" title={t("faq.title")} narrow tone="soft">
        <FaqList items={faq} />
      </Section>
      <CtaBand t={t} lang={lang} />
      <JsonLd data={faqLd(faq.map((f) => ({ q: fillPlain(f.q), a: fillPlain(f.a) })))} />
    </>
  );
}
