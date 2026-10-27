import Link from "next/link";

import { CloseBand } from "@/components/v2/site/HomeSections";
import { DashRows, slate, V3Section } from "@/components/v2/site/PackSections";
import { h1Home, linkQuiet, wrapHome } from "@/components/v2/site/ui";
import { SECURITY_ADDRESS } from "@/lib/site/business";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { sitePath } from "@/lib/site/paths";

const BLOCKS = ["apart", "who", "transit", "signin", "rights", "ai", "kids", "where"] as const;

/**
 * Security and privacy (job CM), in plain words and only what is true today: each business kept apart, who sees what, the owner's rights, AI labelling, children's data (rules, not live) and where data is kept (not hosted
 * for real customers yet). It ends with what has NOT been done: an independent review, real customer data in a hosted system, the legal review of children's data.
 */
export function SecurityPage({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <section aria-labelledby="h1" className="bg-surface pb-[60px] pt-10 sm:pb-[84px]">
        <div className={wrapHome}>
          <h1 id="h1" className={`${h1Home} max-w-4xl`}>
            {t("sec.title")}
          </h1>
          <p className={`mt-7 max-w-[31em] text-lg leading-relaxed sm:text-xl ${slate}`}>{t("sec.sub")}</p>
        </div>
      </section>
      <V3Section id="how" title={t("nav.security")} tone="mist">
        <ul className="m-0 grid list-none gap-0 border-t border-line p-0 md:grid-cols-2" data-part="security">
          {BLOCKS.map((b) => (
            <li key={b} className="border-b border-line py-8 md:pr-10">
              <h3 className="text-2xl font-bold tracking-[-0.01em]">{t(`sec.${b}.t`)}</h3>
              <p className={`mt-2 text-[16.5px] ${slate}`}>{t(`sec.${b}.d`)}</p>
            </li>
          ))}
        </ul>
      </V3Section>
      <V3Section id="report" title={t("sec.report.t")}>
        <p className="max-w-[44em] text-[19px]" data-part="report">
          {t("sec.report.d", { address: SECURITY_ADDRESS })}
        </p>
        <p className={`mt-4 text-[15.5px] ${slate}`}>
          <a href="/.well-known/security.txt" className={linkQuiet}>
            RFC 9116
          </a>
        </p>
      </V3Section>
      <V3Section id="notyet" title={t("sec.notyet.t")} tone="mist" split>
        <DashRows part="not-yet" items={([1, 2, 3, 4] as const).map((n) => t(`sec.notyet.${n}`))} />
        <p className="mt-6 flex flex-wrap items-center gap-x-4">
          <Link href="/privacy" className={linkQuiet}>
            {t("sec.more")}
          </Link>
          <Link href={sitePath(lang, { kind: "page", page: "contact" })} className={linkQuiet}>
            {t("sec.ask")}
          </Link>
        </p>
      </V3Section>
      <CloseBand t={t} lang={lang} />
    </>
  );
}
