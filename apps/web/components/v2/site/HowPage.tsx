import { Repeat } from "lucide-react";

import { LeadDeskSteps } from "@/components/v2/site/LeadDeskSteps";
import { CtaBand, Section } from "@/components/v2/site/sections";
import { workerSteps } from "@/components/v2/site/steps";
import { WORKER_ICONS } from "@/components/v2/app/mark/workers";
import { card, container, lead } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, say, textIn } from "@/lib/site/packs";

/** How it works (job CM; the six AI workers in the order of the workflow since job DM; Lead Desk's own six steps first since night 4): the six steps of Lead Desk, then the six AI workers of the full team, each with the icon of its job and, where a kind of business uses other words, those words (a school's own steps), then what always waits for the owner and the habits that keep a WhatsApp number safe. */
export function HowPage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("how.title")}
        </h1>
        <p className={lead}>{t("how.sub")}</p>
      </section>
      <Section id="lead-desk" title={t("ld.steps.title")} sub={t("ld.steps.sub")}>
        <LeadDeskSteps t={t} />
        <p className="mt-4 text-base font-semibold text-ink" data-part="calling-rules">
          {t("ld.rules")}
        </p>
      </Section>
      <Section id="steps" title={t("how.steps.t")} tone="soft">
        <ol className="flex flex-col gap-3" data-part="steps">
          {workerSteps(t).map((s) => {
            const Icon = WORKER_ICONS[s.n - 1];
            return (
              <li key={s.n} data-step={s.n} className={`${card} flex items-start gap-4`}>
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-bg text-brand-text">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">
                    <span aria-hidden="true" className="mr-1.5 font-display font-extrabold text-muted">
                      {s.n}
                    </span>
                    {s.name}
                    {s.early ? <span className="ml-2 inline-flex rounded-full bg-brand-bg px-2.5 py-0.5 align-middle text-xs font-extrabold text-brand-text">{t("hm.wf.early")}</span> : null}
                  </h3>
                  <p className="mt-0.5 text-base text-muted">{s.text}</p>
                  <p className="mt-1 text-sm font-bold text-muted">{s.you}</p>
                  <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
                    {SITE_PACKS.map((p) => {
                      const own = p.steps?.[String(s.n) as "1"];
                      if (!own) return null;
                      return (
                        <li key={p.slug} data-pack-step={p.slug}>
                          {t("how.calledIn", { name: textIn(p.names, lang) })}{" "}
                          <span className="font-semibold text-ink">{say(own.title, lang)}</span>. {say(own.text, lang)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 flex items-center gap-2.5 text-base font-semibold text-ink" data-part="loop">
          <Repeat className="size-5 shrink-0 text-brand-text" aria-hidden="true" />
          {t("hm.loop")}
        </p>
      </Section>
      <Section id="waits" title={t("how.waits.t")} narrow>
        <ul className="flex flex-col gap-3" data-part="waits">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n} className={card}>
              <p className="text-base">{t(`how.waits.${n}`)}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="habits" title={t("how.habits.t")} tone="soft" narrow>
        <ul className="flex flex-col gap-3">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n} className={card}>
              <p className="text-base">{t(`how.habits.${n}`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("how.habits.note")}</p>
      </Section>
      <CtaBand t={t} lang={lang} />
    </>
  );
}
