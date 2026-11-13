import Link from "next/link";
import type { ReactNode } from "react";

import { CHIP_STATUS, LEAD_CHIPS, type ChipCounts, type LeadChip } from "@/lib/leads-v6/chips";
import type { LeadRow } from "@/lib/leads-v6/rows";

import { EmptyNext } from "../ds/EmptyNext";
import { PageHeader } from "../ds/PageHeader";
import { StatusPill } from "../ds/StatusPill";
import { btnMain, btnQuiet, fieldInput, pageMain } from "../ui";
import { ChipBar } from "../v6/ChipBar";
import { card, withPanel } from "../v6/ui";
import { makeT, type Words } from "../words";

export type Touch = { at: string; kind: "first" | "repeat"; source: string };
export type LeadsV6Props = {
  words: Words;
  lang: string;
  base: string;
  /** The "?" help (helpTipFor(lang, base, "leads", true)). */
  help: ReactNode;
  rows: readonly LeadRow[];
  counts: ChipCounts;
  chip: LeadChip | "all";
  q: string;
  /** The lead source names in the person's language (tag -> name). */
  sourceNames: Readonly<Record<string, string>>;
  selected: LeadRow | null;
  touches: readonly Touch[] | null;
  /** The address of a chip / of a row, made by the page (it keeps the other parts of the state). */
  chipHref: (chip: LeadChip | "all") => string;
  rowHref: (row: LeadRow) => string;
  moreHref: string | null;
  canAdd: boolean;
  /** True when the Leads could not be read at all. */
  unavailable: boolean;
  mock: boolean;
};

const dateText = (iso: string, lang: string): string => (iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "");

/**
 * The Leads page of design system v6 (owner 13 Nov 2026): the Calls-style table with the six status chips and their counts, a search, and the customer's panel on the right (under the table on a phone). Lead Desk's leads and the businesses the
 * Lead Finder found nearby sit in the same table; a found business says "Found nearby" and names the Lead Finder as its source. A server part: the state is in the address, so every chip and row is a link.
 */
export function LeadsV6({ words, lang, base, help, rows, counts, chip, q, sourceNames, selected, touches, chipHref, rowHref, moreHref, canAdd, unavailable, mock }: LeadsV6Props) {
  const t = makeT(words);
  const sourceOf = (r: LeadRow): string => (r.kind === "found" ? t("lv6.finder") : r.source ? (sourceNames[r.source] ?? r.source.replace(/_/g, " ")) : t("lv6.nosource"));
  const addLink = canAdd ? (
    <Link href={`${base}/add-lead`} className={btnMain}>
      {t("lv6.add")}
    </Link>
  ) : null;
  const header = <PageHeader title={t("lv6.title")} sub={t("lv6.sub")} right={<>{help}{addLink}</>} />;
  if (unavailable) {
    return (
      <main className={pageMain} lang={lang} data-part="leads-v6">
        {header}
        <p className="mt-6 text-base text-muted">{t("lv6.na")}</p>
      </main>
    );
  }
  if (counts.all === 0 && q === "") {
    return (
      <main className={pageMain} lang={lang} data-part="leads-v6">
        {header}
        <div className="mt-8">
          <EmptyNext title={t("lv6.empty.title")} text={t("lv6.empty.text")} action={{ href: canAdd ? `${base}/add-lead` : base, label: canAdd ? t("lv6.add") : t("lv6.empty.today") }} />
        </div>
      </main>
    );
  }
  const chips = [{ id: "all", label: t("lv6.chip.all"), count: counts.all, href: chipHref("all") }, ...LEAD_CHIPS.map((c) => ({ id: c, label: t(`lv6.chip.${c}`), count: counts[c], href: chipHref(c) }))];
  return (
    <main className={pageMain} lang={lang} data-part="leads-v6">
      {header}
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("lv6.mock")}
        </p>
      ) : null}
      <form method="get" action={`${base}/lead-desk`} role="search" className="mt-5 flex flex-wrap items-center gap-2">
        {chip !== "all" ? <input type="hidden" name="chip" value={chip} /> : null}
        <label htmlFor="lv6-q" className="sr-only">
          {t("lv6.search.label")}
        </label>
        <input id="lv6-q" name="q" type="search" maxLength={80} defaultValue={q} placeholder={t("lv6.search.ph")} className={`${fieldInput} min-w-0 flex-1 md:max-w-md`} />
        <button type="submit" className={btnQuiet}>
          {t("lv6.search.go")}
        </button>
      </form>
      <div className="mt-4">
        <ChipBar label={t("lv6.chips.label")} chips={chips} active={chip} />
      </div>
      <div className={withPanel}>
        <section aria-label={t("lv6.title")} className="min-w-0">
          {rows.length === 0 ? (
            <p className={`${card} text-base text-muted`}>{t("lv6.none")}</p>
          ) : (
            <table data-part="leads-table" className="w-full border-separate border-spacing-y-2 text-left">
              <thead className="hidden md:table-header-group">
                <tr className="text-sm font-semibold text-muted">
                  <th scope="col" className="px-3 py-1">{t("lv6.col.customer")}</th>
                  <th scope="col" className="px-3 py-1">{t("lv6.col.wants")}</th>
                  <th scope="col" className="px-3 py-1">{t("lv6.col.source")}</th>
                  <th scope="col" className="px-3 py-1">{t("lv6.col.status")}</th>
                  <th scope="col" className="px-3 py-1">{t("lv6.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = selected?.key === r.key;
                  return (
                    <tr key={r.key} data-lead={r.key} data-selected={on ? "true" : undefined} className={`block rounded-xl border bg-surface shadow-[var(--v2-shadow)] md:table-row ${on ? "border-brand-edge" : "border-line"}`}>
                      <td className="block px-3 pb-1 pt-3 md:table-cell md:py-3">
                        <Link href={rowHref(r)} aria-current={on ? "true" : undefined} className="break-words font-display text-lg font-semibold text-brand-text hover:underline">
                          {r.name}
                        </Link>
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {r.isNew ? <span className="rounded-full bg-brand-bg px-2 text-xs font-semibold text-brand-text">{t("lv6.badge.new")}</span> : null}
                          {r.hot ? <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold text-ink">{t("lv6.badge.hot")}</span> : null}
                          {r.nearby ? <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold text-muted">{t("lv6.nearby")}</span> : null}
                        </span>
                      </td>
                      <td className="block px-3 py-1 text-base text-muted md:table-cell md:py-3">{r.line || "-"}</td>
                      <td className="block px-3 py-1 text-sm text-muted md:table-cell md:py-3">{sourceOf(r)}</td>
                      <td className="block px-3 py-1 md:table-cell md:py-3">
                        <StatusPill status={CHIP_STATUS[r.chip]}>{t(`lv6.chip.${r.chip}`)}</StatusPill>
                      </td>
                      <td className="block px-3 pb-3 pt-1 text-sm text-muted md:table-cell md:py-3">{dateText(r.at, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {moreHref ? (
            <p className="mt-3">
              <Link href={moreHref} className={btnQuiet}>
                {t("lv6.more")}
              </Link>
            </p>
          ) : null}
        </section>
        <aside aria-label={t("lv6.panel.label")} data-part="lead-panel" className={`${card} h-fit`}>
          {selected === null ? (
            <p className="text-base text-muted">{t("lv6.panel.none")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="break-words font-display text-2xl font-semibold">{selected.name}</h2>
                <div className="mt-2">
                  <StatusPill status={CHIP_STATUS[selected.chip]}>{t(`lv6.chip.${selected.chip}`)}</StatusPill>
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
                <dt className="text-muted">{t("lv6.panel.source")}</dt>
                <dd>
                  {sourceOf(selected)}
                  {selected.nearby ? <span className="text-muted"> · {t("lv6.nearby")}</span> : null}
                </dd>
                <dt className="text-muted">{t("lv6.panel.came")}</dt>
                <dd>{dateText(selected.at, lang)}</dd>
                {selected.line ? (
                  <>
                    <dt className="text-muted">{t("lv6.panel.wants")}</dt>
                    <dd>{selected.line}</dd>
                  </>
                ) : null}
                {selected.phone ? (
                  <>
                    <dt className="text-muted">{t("lv6.panel.phone")}</dt>
                    <dd className="font-semibold">{selected.phone}</dd>
                  </>
                ) : null}
              </dl>
              <Link href={selected.kind === "lead" ? `${base}/leads/${selected.id}` : `${base}/retailers?id=${encodeURIComponent(selected.id)}`} className={btnMain}>
                {t(selected.kind === "lead" ? "lv6.panel.open" : "lv6.panel.open.found")}
              </Link>
              {selected.kind === "lead" ? (
                <div data-part="lead-history">
                  <h3 className="mb-2 font-display text-lg font-semibold">{t("lv6.panel.history")}</h3>
                  {touches === null || touches.length === 0 ? (
                    <p className="text-sm text-muted">{t("lv6.panel.nohist")}</p>
                  ) : (
                    <ol className="flex flex-col gap-2 border-l-2 border-line pl-3">
                      {touches.map((x, i) => (
                        <li key={`${x.at}-${i}`} className="text-base">
                          <span className="font-semibold">{t(x.kind === "first" ? "lv6.panel.first" : "lv6.panel.repeat")}</span>
                          <span className="text-muted">
                            {" "}
                            · {sourceNames[x.source] ?? x.source.replace(/_/g, " ")} · {dateText(x.at, lang)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
