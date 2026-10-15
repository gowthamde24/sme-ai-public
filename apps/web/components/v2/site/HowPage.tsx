import { Repeat } from "lucide-react";

import { PlushStill } from "@/components/v2/app/owl/PlushStill";
import { CtaBand, Section } from "@/components/v2/site/sections";
import { TeamLead, sixSteps } from "@/components/v2/site/steps";
import { card, container, lead } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, owlName, say, textIn } from "@/lib/site/packs";

/** How it works (job CM, the six steps since job CZ): Agent OWL as the team lead and the six steps, each with its helper owl and, where a kind of business uses other words, those words (a school's own steps 1 and 2, the helper's name in each pack), then what always waits for the owner and the habits that keep a WhatsApp number safe. */
export function HowPage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("how.title")}
        </h1>
        <p className={lead}>{t("how.sub")}</p>
      </section>
      <Section id="owls" title={t("how.owls.t")}>
        <TeamLead t={t} />
        <ol className="mt-4 flex flex-col gap-3" data-part="steps">
          {sixSteps(t).map((s) => (
            <li key={s.n} data-step={s.n} data-owl={s.owl} className={`${card} flex items-start gap-4`}>
              <PlushStill agent={s.owl} px={64} className="size-16" />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">
                  <span aria-hidden="true" className="mr-1.5 font-display font-extrabold text-muted">
                    {s.n}
                  </span>
                  {s.title}
                </h3>
                <p className="text-base font-bold text-brand-text">{s.helper}</p>
                <p className="mt-0.5 text-base text-muted">{s.text}</p>
                <p className="mt-0.5 text-sm font-bold text-muted">{s.you}</p>
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
                  {SITE_PACKS.map((p) => {
                    const own = p.steps?.[s.n as "1"];
                    const name = owlName(p, s.owl, lang);
                    const differs = name && name !== s.helper;
                    if (!own && !differs) return null;
                    return (
                      <li key={p.slug} data-pack-step={p.slug}>
                        {t("how.calledIn", { name: textIn(p.names, lang) })}{" "}
                        {differs ? <span className="font-semibold text-ink">{name}</span> : null}
                        {differs && own ? " · " : null}
                        {own ? (
                          <>
                            <span className="font-semibold text-ink">{say(own.title, lang)}</span>. {say(own.text, lang)}
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-center gap-2.5 text-base font-semibold text-ink" data-part="loop">
          <Repeat className="size-5 shrink-0 text-brand-text" aria-hidden="true" />
          {t("home.how.loop")}
        </p>
      </Section>
      <Section id="waits" title={t("how.waits.t")} tone="soft" narrow>
        <ul className="flex flex-col gap-3" data-part="waits">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n} className={card}>
              <p className="text-base">{t(`how.waits.${n}`)}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="habits" title={t("how.habits.t")} narrow>
        <ul className="flex flex-col gap-3">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n} className={card}>
              <p className="text-base">{t(`how.habits.${n}`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("how.habits.note")}</p>
      </Section>
      <CtaBand t={t} />
    </>
  );
}
