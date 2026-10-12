import { ArrowRight, Gauge } from "lucide-react";
import Link from "next/link";

import { btnPrimary, card, container, h2, lead } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

/**
 * Pricing (job BS). The prices are NOT decided: they are the plain placeholder [PRICE], and the page says so. Fair use is a meter in percent (the same meter the app shows), never a count of questions.
 */
export function Pricing({ t }: { t: LandingT }) {
  return (
    <section id="pricing" aria-labelledby="price-h" className={`${container} scroll-mt-20 py-14 sm:py-20`}>
      <h2 id="price-h" className={h2}>{t("price.title")}</h2>
      <p className={lead}>{t("price.sub")}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <article className={card} aria-labelledby="price-trial">
          <h3 id="price-trial" className="text-xl font-semibold">{t("price.trial.t")}</h3>
          <p className="mt-2 font-display text-3xl font-bold">{t("price.trial.p")}</p>
          <p className="mt-2 text-muted">{t("price.trial.d")}</p>
          <Link href="/signup" className={`${btnPrimary} mt-5 w-full sm:w-auto`}>
            {t("hero.cta")}
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        </article>
        <article className={card} aria-labelledby="price-shop">
          <h3 id="price-shop" className="text-xl font-semibold">{t("price.shop.t")}</h3>
          <p className="mt-2 font-display text-3xl font-bold">{t("price.shop.p")}</p>
          <p className="mt-2 text-muted">{t("price.shop.d")}</p>
        </article>
      </div>
      <div className={`${card} mt-4`}>
        <h3 className="flex items-center gap-2 text-xl font-semibold">
          <Gauge className="size-6 shrink-0 text-brand-text" aria-hidden="true" />
          {t("price.fair.t")}
        </h3>
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-muted marker:text-brand-text">
          <li>{t("price.fair.1")}</li>
          <li>{t("price.fair.2")}</li>
          <li>{t("price.fair.3")}</li>
        </ul>
      </div>
      <p className="mt-4 text-sm text-muted">{t("price.note")}</p>
    </section>
  );
}
