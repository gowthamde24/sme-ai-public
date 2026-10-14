import { CtaBand, OWLS, Section } from "@/components/v2/site/sections";
import { SiteOwl } from "@/components/v2/site/SiteOwl";
import { card, container, lead } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, owlName, textIn } from "@/lib/site/packs";

/** How it works (job CM): the seven owls and what each does, in each kind of business's own words, then what always waits for the owner and the habits that keep a WhatsApp number safe. */
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
        <ul className="flex flex-col gap-3" data-part="owls">
          {OWLS.map((o) => (
            <li key={o} className={`${card} flex items-start gap-4`}>
              <SiteOwl agent={o} px={64} className="size-16" />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{owlName(SITE_PACKS[0], o, lang) ?? t("owl.name.main")}</h3>
                <p className="mt-0.5 text-base text-muted">{t(`owl.${o}`)}</p>
                <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
                  {SITE_PACKS.filter((p) => owlName(p, o, lang) && owlName(p, o, lang) !== owlName(SITE_PACKS[0], o, lang)).map((p) => (
                    <li key={p.slug}>
                      {t("how.calledIn", { name: textIn(p.names, lang) })} <span className="font-semibold text-ink">{owlName(p, o, lang)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
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
