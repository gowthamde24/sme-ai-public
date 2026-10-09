import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Flow } from "@/components/v2/landing/Flow";
import { buildFlowLabels } from "@/components/v2/landing/flow-labels";
import { btnPrimary, container } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

export function Hero({ t }: { t: LandingT }) {
  return (
    <section aria-labelledby="h1" className={`${container} pb-8 pt-4 sm:pb-10 sm:pt-8 lg:pb-14 lg:pt-8`}>
      <p className="text-sm font-semibold text-brand-text sm:text-base">{t("hero.eyebrow")}</p>
      <h1 id="h1" className="mt-2 max-w-4xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl xl:text-6xl">
        {t("hero.h1")}
      </h1>
      <p className="mt-3 max-w-4xl text-base leading-relaxed text-muted sm:text-lg">{t("hero.sub")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Link href="/signup" className={`${btnPrimary} max-sm:min-h-12`}>
          {t("hero.cta")}
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        <a href="#how" className="hidden min-h-11 items-center rounded-lg px-2 text-base font-semibold text-brand-text hover:underline sm:inline-flex">
          {t("hero.secondary")}
        </a>
        <p className="hidden text-sm text-muted sm:block">{t("hero.note")}</p>
      </div>
      {/* the whole pipeline in one row, in the first screen, starting by itself */}
      <div className="mt-4 sm:mt-6">
        <Flow labels={buildFlowLabels(t)} />
      </div>
    </section>
  );
}
