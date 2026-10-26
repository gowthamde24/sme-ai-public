import Link from "next/link";
import type { ReactNode } from "react";

import { FeatureIcon } from "@/components/v2/site/icons";
import { btnPrimary, card, chip, container, h2, lead, section } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { say } from "@/lib/site/packs";
import { startEntry } from "@/lib/site/entry";
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

/** The call to action at the foot of every inner page: start the trial (the sign-up asks which business). */
export function CtaBand({ t, lang, hasForm = false }: { t: SiteT; lang: Lang; hasForm?: boolean }) {
  const start = startEntry(t, lang, t("cta.start"), { hasForm });
  return (
    <section aria-labelledby="cta-h" className={`${section} bg-brand-bg`}>
      <div className={`${container} flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 id="cta-h" className="font-display text-2xl font-bold sm:text-3xl">
            {t("cta.title")}
          </h2>
          <p className="mt-2 text-base text-muted">{t("cta.sub")}</p>
        </div>
        <Link href={start.href} className={btnPrimary}>
          {start.label}
        </Link>
      </div>
    </section>
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
