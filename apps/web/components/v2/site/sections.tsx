import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PackProp } from "@/components/v2/auth/PackCard";
import { FeatureIcon } from "@/components/v2/site/icons";
import { SiteOwl } from "@/components/v2/site/SiteOwl";
import { btnPrimary, card, chip, container, h2, lead, section } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { SITE_PACKS, owlName, say, textIn } from "@/lib/site/packs";
import { sitePath } from "@/lib/site/paths";
import type { IconId, OwlId, SitePack, Text } from "@/lib/site/types";

export const OWLS: readonly OwlId[] = ["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"];

/** A titled block of a page: an `<h2>` with an optional line under it, then the content. */
export function Section({ id, title, sub, children, narrow = false, tone }: { id: string; title: string; sub?: string; children: ReactNode; narrow?: boolean; tone?: "soft" }) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className={`${tone === "soft" ? "bg-surface-2" : ""} ${section} scroll-mt-20`}>
      <div className={`${container} ${narrow ? "max-w-3xl" : ""}`}>
        <h2 id={`${id}-h`} className={h2}>
          {title}
        </h2>
        {sub ? <p className={lead}>{sub}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/** Questions and answers as native disclosures (no script). */
export function FaqList({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-surface">
      {items.map((it, i) => (
        <details key={i} className="group">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {it.q}
            <span aria-hidden="true" className="text-2xl leading-none text-brand-text transition-transform duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="px-5 pb-5 text-base text-muted">{it.a}</p>
        </details>
      ))}
    </div>
  );
}

/** The one call to action of the site: sign up and choose the business. */
export function CtaBand({ t }: { t: SiteT }) {
  return (
    <section aria-labelledby="cta-h" className={`${section} bg-brand-bg`}>
      <div className={`${container} flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 id="cta-h" className="font-display text-2xl font-bold sm:text-3xl">
            {t("cta.title")}
          </h2>
          <p className="mt-2 text-base text-muted">{t("cta.sub")}</p>
        </div>
        <Link href="/signup" className={btnPrimary}>
          {t("hero.cta")}
        </Link>
      </div>
    </section>
  );
}

/** The seven owls, each with one job. The names are the default business type's own words (its pack's `agent.*` labels). */
export function OwlTeam({ t, lang }: { t: SiteT; lang: Lang }) {
  const names = SITE_PACKS[0];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-part="owl-team">
      {OWLS.map((o) => (
        <li key={o} className={`${card} flex flex-col items-center gap-2 text-center`}>
          <SiteOwl agent={o} px={80} smPx={96} className="size-20 sm:size-24" />
          <p className="font-display text-lg font-semibold leading-tight">{(names && owlName(names, o, lang)) || t("owl.name.main")}</p>
          <p className="text-sm text-muted">{t(`owl.${o}`)}</p>
        </li>
      ))}
    </ul>
  );
}

/** A business type's card on the home page: its owl with the trade's prop in its accent colour, its name and line, and a link to its page. */
export function PackCards({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3" data-part="pack-cards">
      {SITE_PACKS.map((p) => {
        const name = textIn(p.names, lang);
        return (
          <li key={p.slug}>
            <Link href={sitePath(lang, { kind: "pack", slug: p.slug })} data-pack-card={p.slug} className="group flex h-full flex-col gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors duration-150 ease-out hover:bg-surface-2">
              <span className="relative self-start">
                <SiteOwl agent="main" px={72} className="size-[72px]" />
                <span data-accent={p.accent} aria-hidden="true" className="absolute -bottom-1 -right-3 grid size-9 place-items-center rounded-full border-2 border-surface bg-pack-bg text-pack-text">
                  <PackProp owlProp={p.owlProp} className="size-5" />
                </span>
              </span>
              <span className="block font-display text-xl font-semibold leading-tight">{name}</span>
              <span className="block text-base text-muted">{say(p.hero.eyebrow, lang)}</span>
              {!p.validated ? (
                <span className="block text-sm font-medium text-pack-text" data-accent={p.accent}>
                  {t("packs.notValidated")}
                </span>
              ) : null}
              <span className="mt-auto inline-flex min-h-11 items-center gap-1 text-base font-semibold text-brand-text">
                {t("packs.see", { name })}
                <ChevronRight className="size-5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Steps({ t }: { t: SiteT }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {([1, 2, 3] as const).map((n) => (
        <li key={n} className={card}>
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-brand text-base font-bold text-on-brand">
            {n}
          </span>
          <h3 className="mt-3 text-xl font-semibold">{t(`step.${n}.t`)}</h3>
          <p className="mt-1 text-base text-muted">{t(`step.${n}.d`)}</p>
        </li>
      ))}
    </ol>
  );
}

export function TrustStrip({ t, lang }: { t: SiteT; lang: Lang }) {
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-part="trust">
        {([1, 2, 3, 4] as const).map((n) => (
          <li key={n} className={card}>
            <h3 className="text-lg font-semibold">{t(`trust.${n}.t`)}</h3>
            <p className="mt-1 text-base text-muted">{t(`trust.${n}.d`)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-4">
        <Link href={sitePath(lang, { kind: "page", page: "security" })} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
          {t("trust.more")}
        </Link>
      </p>
    </>
  );
}

/** The rows of a pack page: a titled grid of feature cards. */
export function FeatureGrid({ items, lang }: { items: readonly { icon: IconId; title: Text; body: Text }[]; lang: Lang }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((f, i) => (
        <li key={i} className={`${card} flex gap-4`}>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
            <FeatureIcon id={f.icon} />
          </span>
          <div>
            <h3 className="text-lg font-semibold">{say(f.title, lang)}</h3>
            <p className="mt-1 text-base text-muted">{say(f.body, lang)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export { chip };
export type { SitePack };
