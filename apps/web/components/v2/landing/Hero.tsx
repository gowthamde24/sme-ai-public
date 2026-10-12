import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentOwl3D } from "@/components/v2/app/owl/AgentOwl3D";
import { btnPrimary, container } from "@/components/v2/landing/ui";
import type { LandingT } from "@/i18n/landing";

const bubble = "max-w-[92%] rounded-2xl px-4 py-3 text-base leading-snug";

/**
 * The first screen (job BS): the promise in one sentence, the sign-up button, and Agent OWL itself (the 3D owl, which falls back to the flat one on a weak device or a slow connection and loads only
 * when the page is idle, so the headline is the first thing painted) beside an example conversation that is labelled as made up.
 */
export function Hero({ t }: { t: LandingT }) {
  return (
    <section aria-labelledby="h1" className={`${container} grid items-center gap-8 pb-10 pt-4 sm:pt-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:pb-16`}>
      <div>
        <p className="text-sm font-semibold text-brand-text sm:text-base">{t("hero.eyebrow")}</p>
        <h1 id="h1" className="mt-2 max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl xl:text-6xl">
          {t("hero.h1")}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{t("hero.sub")}</p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/signup" className={`${btnPrimary} max-sm:min-h-12`}>
            {t("hero.cta")}
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
          <a href="#how" className="inline-flex min-h-11 items-center rounded-lg px-2 text-base font-semibold text-brand-text hover:underline">
            {t("hero.secondary")}
          </a>
        </div>
        <p className="mt-3 text-sm text-muted">{t("hero.note")}</p>
      </div>
      <div className="relative">
        <div className="flex justify-center lg:justify-end">
          <AgentOwl3D mood="idle" name="Agent OWL" moodText={t("hero.owl.mood")} className="size-[168px]! sm:size-56!" />
        </div>
        <figure aria-label={t("chat.label")} className="mt-2 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>{t("chat.label")}</span>
            <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 font-medium text-ink">{t("chat.example")}</span>
          </figcaption>
          <div className="mt-3 flex flex-col gap-2">
            <p className={`${bubble} self-start bg-surface-2 text-ink`}>
              <span className="mb-0.5 block text-sm font-medium text-muted">{t("chat.customer")}</span>
              {t("chat.c1")}
            </p>
            <p className={`${bubble} self-end bg-brand-bg text-ink`}>
              <span className="mb-0.5 block text-sm font-medium text-brand-text">{t("chat.owl")}</span>
              {t("chat.a1")}
            </p>
            <p className={`${bubble} self-start bg-surface-2 text-ink`}>
              <span className="mb-0.5 block text-sm font-medium text-muted">{t("chat.customer")}</span>
              {t("chat.c2")}
            </p>
          </div>
        </figure>
      </div>
    </section>
  );
}
