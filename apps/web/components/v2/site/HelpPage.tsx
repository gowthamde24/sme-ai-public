import Link from "next/link";

import { CtaBand, Section } from "@/components/v2/site/sections";
import { card, container, lead, linkQuiet } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { sitePath, type SiteTarget } from "@/lib/site/paths";

/** What each topic points to ("Read more"): the page that explains it, or sign-up. */
const TOPICS: { n: 1 | 2 | 3 | 4 | 5 | 6 | 7; to: SiteTarget | "signup" }[] = [
  { n: 1, to: "signup" },
  { n: 2, to: { kind: "page", page: "how-it-works" } },
  { n: 3, to: { kind: "page", page: "how-it-works" } },
  { n: 4, to: { kind: "page", page: "how-it-works" } },
  { n: 5, to: { kind: "home" } },
  { n: 6, to: { kind: "page", page: "security" } },
  { n: 7, to: { kind: "page", page: "pricing" } },
];

/**
 * The help index (job CM): short answers by topic, each pointing to the page that explains it, and the way to ask us on WhatsApp. There are no separate help articles yet; the in-app help is for signed-in people.
 */
export function HelpPage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("help.title")}
        </h1>
        <p className={lead}>{t("help.sub")}</p>
      </section>
      <Section id="topics" title={t("help.title")}>
        <ul className="grid gap-4 md:grid-cols-2" data-part="help-topics">
          {TOPICS.map(({ n, to }) => (
            <li key={n} className={`${card} flex flex-col`}>
              <h3 className="text-lg font-semibold">{t(`help.${n}.t`)}</h3>
              <p className="mt-1 text-base text-muted">{t(`help.${n}.d`)}</p>
              <Link href={to === "signup" ? "/signup" : sitePath(lang, to)} className={`${linkQuiet} mt-auto self-start`}>
                {t("help.more")}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6">
          <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={linkQuiet}>
            {t("sec.ask")}
          </Link>
        </p>
      </Section>
      <CtaBand t={t} />
    </>
  );
}
