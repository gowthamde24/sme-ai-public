import { ChevronDown } from "lucide-react";
import Link from "next/link";

import type { CallStatusWord } from "@/lib/api/calls";
import { callsHref, WHEN_RANGES, type CallsQuery, type WhenRange } from "@/lib/calls/filter";
import { STATUS_ORDER } from "@/lib/calls/status";

import { makeT, type Words } from "../../words";

/**
 * The top of the Calls page (design system v6): the search box, the status chips with their counts (All · Completed · Transferred · No answer · Rejected · Spam · Live) and the date and number dropdowns. All of it is plain links and one GET form, so it works
 * without a script and every state is in the address (lib/calls/filter.ts). A dropdown is a `<details>` with a list of links; it is keyed by the address, so choosing one draws the page again with the dropdown closed.
 */
export type CallsFiltersProps = { words: Words; base: string; query: CallsQuery; counts: Record<CallStatusWord | "all", number>; lines: readonly { id: string; label: string }[] };

const chip = "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[13px] whitespace-nowrap";
const chipOff = `${chip} border-line bg-surface text-ink hover:bg-surface-2`;
const chipOn = `${chip} border-ink bg-ink text-bg`;
const dropBtn = "inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden";

export function CallsFilters({ words, base, query, counts, lines }: CallsFiltersProps) {
  const t = makeT(words);
  const here = callsHref(base, query);
  const whenLabel = (w: WhenRange) => t(`calls6.when.${w}`);
  const lineLabel = query.line ? (lines.find((l) => l.id === query.line)?.label ?? t("calls6.line.all")) : t("calls6.line.all");
  return (
    <div className="flex flex-col gap-3" data-part="calls-filters">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t("calls6.chips.label")} className="flex flex-wrap gap-2" data-part="calls-chips">
          {(["all", ...STATUS_ORDER] as const).map((s) => (
            <Link key={s} href={callsHref(base, { ...query, status: s })} aria-current={query.status === s ? "true" : undefined} data-chip={s} className={query.status === s ? chipOn : chipOff}>
              {s !== "all" ? (
                <span data-status={s} className="inline-flex size-4 items-center justify-center rounded-full">
                  <span data-dot="" className="size-2 rounded-full bg-current" />
                </span>
              ) : null}
              {t(`calls6.st.${s}`)}
              <b className="font-bold tabular-nums">{counts[s].toLocaleString("en-IN")}</b>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          <details key={`when-${here}`} className="relative" data-part="calls-when">
            <summary className={dropBtn}>
              {whenLabel(query.when)}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </summary>
            <ul className="absolute right-0 z-20 m-0 mt-2 flex min-w-48 list-none flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--v2-shadow-pop)]">
              {WHEN_RANGES.map((w) => (
                <li key={w}>
                  <Link href={callsHref(base, { ...query, when: w })} aria-current={query.when === w ? "true" : undefined} className="flex min-h-11 items-center rounded-xl px-3 text-base text-ink hover:bg-surface-2 aria-[current]:font-semibold aria-[current]:text-brand-text">
                    {whenLabel(w)}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
          <details key={`line-${here}`} className="relative" data-part="calls-line">
            <summary className={dropBtn}>
              {lineLabel}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </summary>
            <ul className="absolute right-0 z-20 m-0 mt-2 flex min-w-56 list-none flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--v2-shadow-pop)]">
              <li>
                <Link href={callsHref(base, { ...query, line: null })} aria-current={!query.line ? "true" : undefined} className="flex min-h-11 items-center rounded-xl px-3 text-base text-ink hover:bg-surface-2 aria-[current]:font-semibold aria-[current]:text-brand-text">
                  {t("calls6.line.all")}
                </Link>
              </li>
              {lines.map((l) => (
                <li key={l.id}>
                  <Link href={callsHref(base, { ...query, line: l.id })} aria-current={query.line === l.id ? "true" : undefined} className="flex min-h-11 items-center rounded-xl px-3 text-base text-ink hover:bg-surface-2 aria-[current]:font-semibold aria-[current]:text-brand-text">
                    {l.label}
                  </Link>
                </li>
              ))}
              {lines.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{t("calls6.line.none")}</li> : null}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
