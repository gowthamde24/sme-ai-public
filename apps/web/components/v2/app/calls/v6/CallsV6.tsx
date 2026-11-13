import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyNext } from "@/components/v2/app/ds/EmptyNext";
import { PageHeader } from "@/components/v2/app/ds/PageHeader";
import type { TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { CallDetail, CallRow } from "@/lib/api/calls";
import type { TimelineItem } from "@/lib/api/customer-timeline";
import { byStatus, callsHref, lineOptions, narrow, type CallsQuery } from "@/lib/calls/filter";
import { statusCounts } from "@/lib/calls/status";
import { refuseWhy } from "@/lib/calls/view";

import { btnMain, btnQuiet, pageMain } from "../../ui";
import { makeT, type Words } from "../../words";
import { CallPanel } from "./CallPanel";
import { CallsFilters } from "./CallsFilters";
import { CallsTable } from "./CallsTable";
import { LiveStrip } from "./Lazy";
import type { LiveControlsProps } from "./LiveControls";

export type CallsV6Props = {
  words: Words;
  lang: string;
  base: string;
  query: CallsQuery;
  /** the calls the API sent (null: they could not be read) */
  calls: readonly CallRow[] | null;
  now: number;
  olderHref: string | null;
  selectedId: string | null;
  /** the open call: the detail, or null when it could not be read */
  selected: { call: CallDetail | null; timeline: readonly TimelineItem[] | null } | null;
  when: (iso: string) => string;
  language: string | null;
  canRead: boolean;
  teach: TeachActions | null;
  approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null;
  liveControls: Omit<LiveControlsProps, "words"> | null;
  /** the "?" of the page (design system v6), drawn by the page */
  help: ReactNode;
  /** the Owner's "Place a test call" address; null where there is none */
  testHref: string | null;
  /** the page reads itself again while a call is live */
  repoll: ReactNode;
};

/**
 * The Calls page of design system v6 (owner, 13 Nov 2026): the header and search, the live strip when calls are live, the status chips with counts and the date and number dropdowns, the table, and the right panel for the open call. On a phone the table and the panel
 * are two screens: the list, then the call with a way back. An empty workspace shows its next step ("Make a test call"). Server markup; the live strip and the panel's interactive parts are chunks of their own.
 */
export function CallsV6(p: CallsV6Props) {
  const t = makeT(p.words);
  const why = (reason: string | null) => p.words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const all = p.calls ?? [];
  const narrowed = narrow(all, p.query, p.now, p.words, why);
  const counts = statusCounts(narrowed);
  const shown = byStatus(narrowed, p.query.status);
  const live = all.filter((c) => c.live);
  const open = p.selectedId !== null;
  const filtered = p.query.status !== "all" || p.query.when !== "any" || p.query.line !== null || p.query.q !== "";
  const emptyPage = p.calls !== null && all.length === 0 && !open;
  const header = (
    <PageHeader
      title={t("calls6.title")}
      sub={t("calls6.sub")}
      right={
        p.testHref && !emptyPage ? (
          <Link href={p.testHref} className={btnMain} data-part="test-call-entry">
            {t("calls6.test")}
          </Link>
        ) : null
      }
    />
  );
  if (emptyPage)
    return (
      <main className={pageMain} lang={p.lang} data-screen="calls">
        {p.help}
        {header}
        <div className="mt-8">
          <EmptyNext title={t("calls6.empty.title")} text={t("calls6.empty.text")} action={{ href: p.testHref ?? `${p.base}/my-assistant`, label: t("calls6.empty.action") }} help={t("calls6.empty.help")} />
        </div>
      </main>
    );
  return (
    <main className={pageMain} lang={p.lang} data-screen="calls">
      {p.help}
      {header}
      <div className="mt-5 flex flex-col gap-4">
        <div className={open ? "hidden lg:block" : undefined}>
          <CallsFilters words={p.words} base={p.base} query={p.query} counts={counts} lines={lineOptions(all)} />
        </div>
        <LiveStrip
          words={p.words}
          calls={live.map((c) => ({ id: c.id, who: c.who || t("ph.dir.inbound"), elapsedS: c.elapsedS, answered: c.answeredAt !== null, href: callsHref(p.base, p.query, c.id) }))}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <div className={`flex min-w-0 flex-col gap-3 ${open ? "hidden lg:flex" : ""}`}>
            {p.calls === null ? (
              <p role="alert" className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
                {t("ph.unread")}
              </p>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-6 text-center" data-part="calls-none">
                <p className="m-0 font-display text-lg font-semibold">{t("calls6.none.title")}</p>
                <p className="m-0 mt-1 text-base text-muted">{t("calls6.none.text")}</p>
                {filtered ? (
                  <Link href={callsHref(p.base, {})} className={`${btnQuiet} mt-3`}>
                    {t("calls6.none.clear")}
                  </Link>
                ) : null}
              </div>
            ) : (
              <CallsTable words={p.words} base={p.base} query={p.query} items={shown} selectedId={p.selectedId} when={p.when} />
            )}
            {p.olderHref ? (
              <Link href={p.olderHref} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-brand-text underline underline-offset-4">
                {t("ph.older")}
              </Link>
            ) : null}
          </div>
          <div className={open ? "" : "hidden lg:block"}>
            {p.selected?.call ? (
              <CallPanel words={p.words} base={p.base} query={p.query} call={p.selected.call} timeline={p.selected.timeline} when={p.when} language={p.language} canRead={p.canRead} teach={p.teach} approve={p.approve} liveControls={p.liveControls} />
            ) : open ? (
              <div className="rounded-2xl border border-line bg-surface p-5" data-part="call-panel-missing">
                <Link href={callsHref(p.base, p.query)} className="text-sm font-semibold text-brand-text underline underline-offset-4">
                  {t("calls6.panel.back")}
                </Link>
                <p role="alert" className="m-0 mt-2 text-sm text-muted">
                  {t("calls6.panel.unread")}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-6 text-center text-base text-muted" data-part="call-panel-empty">
                {t("calls6.panel.pick")}
              </div>
            )}
          </div>
        </div>
      </div>
      {p.repoll}
    </main>
  );
}
