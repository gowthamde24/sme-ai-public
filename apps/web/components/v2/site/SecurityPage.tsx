import Link from "next/link";

import { CtaBand, Section } from "@/components/v2/site/sections";
import { card, container, lead, linkQuiet } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { sitePath } from "@/lib/site/paths";

const BLOCKS = ["apart", "who", "rights", "ai", "kids", "where"] as const;

/**
 * Security and privacy (job CM), in plain words and only what is true today: each business kept apart, who sees what, the owner's rights, AI labelling, children's data (rules, not live) and where data is kept (not hosted
 * for real customers yet). It ends with what has NOT been done: an independent review, real customer data in a hosted system, the legal review of children's data.
 */
export function SecurityPage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("sec.title")}
        </h1>
        <p className={lead}>{t("sec.sub")}</p>
      </section>
      <Section id="how" title={t("nav.security")}>
        <ul className="grid gap-4 md:grid-cols-2" data-part="security">
          {BLOCKS.map((b) => (
            <li key={b} className={card}>
              <h3 className="text-lg font-semibold">{t(`sec.${b}.t`)}</h3>
              <p className="mt-1 text-base text-muted">{t(`sec.${b}.d`)}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="notyet" title={t("sec.notyet.t")} tone="soft" narrow>
        <ul className="flex flex-col gap-3" data-part="not-yet">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className={card}>
              <p className="text-base">{t(`sec.notyet.${n}`)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex flex-wrap items-center gap-x-4">
          <Link href="/privacy" className={linkQuiet}>
            {t("sec.more")}
          </Link>
          <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={linkQuiet}>
            {t("sec.ask")}
          </Link>
        </p>
      </Section>
      <CtaBand t={t} />
    </>
  );
}
