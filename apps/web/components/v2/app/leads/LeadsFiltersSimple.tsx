import { Search } from "lucide-react";

import { LEAD_CHIPS, type ChipCounts, type LeadChip } from "@/lib/leads-v6/chips";

import { filtersOpen } from "@/lib/screens/flag";
import { LinkSentence } from "../jobs/pages/LazyLinkSentence";
import { EffectLine, pgCard } from "../jobs/pages/parts";
import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";
import { cardBox } from "../Card";

export type LeadsFilterSimple = {
  /** the place in the address now (null = everywhere) */
  source: string | null;
  /** the places the leads came from: key (what the address carries), the name in the person's language */
  sources: readonly { key: string; label: string }[];
  sourceHref: (source: string | null) => string;
};

/**
 * The top of the Leads page under JOBS (the simplicity pass): ONE card with "Show [new] leads from [everywhere]." (the status and the place, each a choice inside the sentence, with how many are in each status), the search box and the one line that
 * says what is on the screen now. The six chips and the search of before are all here (the status choice holds the six, the search is the box); each choice goes to an address (`?chip=`, `?source=`, `?q=`) like the chips did.
 */
export function LeadsFiltersSimple({ words, base, chip, q, counts, shown, chipHref, source, sources, sourceHref }: { words: Words; base: string; chip: LeadChip | "all"; q: string; counts: ChipCounts; shown: number; chipHref: (c: LeadChip | "all") => string } & LeadsFilterSimple) {
  const t = makeT(words);
  const num = (n: number) => n.toLocaleString("en-IN");
  const statuses = ["all", ...LEAD_CHIPS] as const;
  const plain = filtersOpen();
  return (
    <section data-part="leads-filters" data-simple="" className={plain ? `${cardBox} flex flex-col gap-3` : `${pgCard} flex flex-col gap-3`}>
      <LinkSentence
        plain={plain}
        line="leads"
        template={t("jobs.pg.leads.line")}
        choices={{
          status: { label: t("lv6.chips.label"), value: chip, options: statuses.map((s) => ({ value: s, text: `${t(`jobs.pg.leads.st.${s}`)} (${num(counts[s])})`, href: chipHref(s) })) },
          source: { label: t("jobs.pg.leads.source"), value: source ?? "all", options: [{ value: "all", text: t("jobs.pg.leads.src.all"), href: sourceHref(null) }, ...sources.map((s) => ({ value: s.key, text: s.label, href: sourceHref(s.key) }))] },
        }}
      />
      <form method="get" action={`${base}/lead-desk`} role="search" className="flex flex-wrap items-center gap-2">
        {chip !== "all" ? <input type="hidden" name="chip" value={chip} /> : null}
        {source ? <input type="hidden" name="source" value={source} /> : null}
        <label className="relative block min-w-0 flex-1 md:max-w-md">
          <span className="sr-only">{t("lv6.search.label")}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input name="q" type="search" maxLength={80} defaultValue={q} placeholder={t("lv6.search.ph")} className="write-ctl min-h-11 w-full rounded-full border border-line bg-surface pl-10 pr-3 text-[15px] text-ink placeholder:text-muted focus:border-brand-edge" />
        </label>
        <button type="submit" className={btnQuiet}>
          {t("lv6.search.go")}
        </button>
      </form>
      {plain ? (
        <p data-part="leads-effect" className="m-0 text-[14px] text-muted">
          {q ? t("jobs.pg.leads.effect.q", { n: num(shown), q }) : t("jobs.pg.leads.effect", { n: num(shown) })}
        </p>
      ) : (
        <EffectLine part="leads-effect" text={q ? t("jobs.pg.leads.effect.q", { n: num(shown), q }) : t("jobs.pg.leads.effect", { n: num(shown) })} />
      )}
    </section>
  );
}
