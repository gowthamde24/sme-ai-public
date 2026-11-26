import { Search } from "lucide-react";

import type { CallStatusWord } from "@/lib/api/calls";
import { callsHref, WHEN_RANGES, type CallsQuery, type WhenRange } from "@/lib/calls/filter";
import { STATUS_ORDER } from "@/lib/calls/status";

import { btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import { filtersOpen } from "@/lib/screens/flag";
import { LinkSentence } from "../../jobs/pages/LazyLinkSentence";
import { MoreBox, pgCard } from "../../jobs/pages/parts";
import { cardBox } from "../../Card";

export type CallsFiltersSimpleProps = { words: Words; base: string; query: CallsQuery; counts: Record<CallStatusWord | "all", number>; lines: readonly { id: string; label: string }[]; shown: number; total: number };

/**
 * The top of the Calls page under JOBS (the simplicity pass): ONE card with the sentence "Show [all] calls from [any time]." (the status and the date, each a choice inside the sentence, the count of each next to its name), the search box, and the one line that says what is
 * on the screen now. The number the calls came in on is under "More choices". Every choice goes to the SAME address the chips and dropdowns of before led to (lib/calls/filter.ts), so a filtered list is shared, reloaded and walked back as always; nothing was removed.
 */
export function CallsFiltersSimple({ words, base, query, counts, lines, shown, total }: CallsFiltersSimpleProps) {
  const t = makeT(words);
  const statuses = ["all", ...STATUS_ORDER] as const;
  const num = (n: number) => n.toLocaleString("en-IN");
  const lineValue = query.line ?? "all";
  const lineOptions = [{ value: "all", text: t("jobs.pg.calls.line.all"), href: callsHref(base, { ...query, line: null }) }, ...lines.map((l) => ({ value: l.id, text: l.label, href: callsHref(base, { ...query, line: l.id }) }))];
  const plain = filtersOpen();
  const filtered = query.status !== "all" || query.when !== "any" || query.line !== null || query.q !== "";
  return (
    <section data-part="calls-filters" data-simple="" aria-label={t("calls6.chips.label")} className={plain ? `${cardBox} flex flex-col gap-3` : `${pgCard} flex flex-col gap-3`}>
      <LinkSentence
        plain={plain}
        line="calls"
        template={t("jobs.pg.calls.line")}
        choices={{
          status: { label: t("jobs.pg.calls.status"), value: query.status, options: statuses.map((s) => ({ value: s, text: `${t(`jobs.pg.calls.st.${s}`)} (${num(counts[s])})`, href: callsHref(base, { ...query, status: s }) })) },
          when: { label: t("calls6.when.label"), value: query.when, options: WHEN_RANGES.map((w: WhenRange) => ({ value: w, text: t(`jobs.pg.calls.when.${w}`), href: callsHref(base, { ...query, when: w }) })) },
        }}
      />
      <form action={`${base}/calls`} method="get" role="search" className="flex flex-wrap items-center gap-2">
        {query.status !== "all" ? <input type="hidden" name="status" value={query.status} /> : null}
        {query.when !== "any" ? <input type="hidden" name="when" value={query.when} /> : null}
        {query.line ? <input type="hidden" name="line" value={query.line} /> : null}
        <label className="relative block min-w-0 flex-1 md:max-w-md">
          <span className="sr-only">
            {t("calls6.search.label")}. {t("calls6.search.note")}
          </span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input type="search" name="q" defaultValue={query.q} maxLength={80} placeholder={t("calls6.search.placeholder")} className="write-ctl min-h-11 w-full rounded-full border border-line bg-surface pl-10 pr-3 text-[15px] text-ink placeholder:text-muted focus:border-brand-edge" />
        </label>
        <button type="submit" className={btnQuiet}>
          {t("calls6.search.go")}
        </button>
      </form>
      {lines.length > 0 || query.line ? (
        plain ? (
          <LinkSentence plain line="calls-line" template={t("jobs.pg.calls.line.sentence")} choices={{ line: { label: t("calls6.line.label"), value: lineValue, options: lineOptions } }} />
        ) : (
          <MoreBox title={t("jobs.pg.more")} sub={t("jobs.pg.calls.more.sub")} open={query.line !== null}>
            <LinkSentence line="calls-line" template={t("jobs.pg.calls.line.sentence")} choices={{ line: { label: t("calls6.line.label"), value: lineValue, options: lineOptions } }} />
          </MoreBox>
        )
      ) : null}
    </section>
  );
}
