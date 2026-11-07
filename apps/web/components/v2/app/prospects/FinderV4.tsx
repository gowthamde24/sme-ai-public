import Link from "next/link";

import type { AppT } from "@/i18n/app";
import type { Availability, CallLanguage, ProspectPage, ProspectStats, ProspectStatus } from "@/lib/lead-finder/types";
import { STATUS_FILTER } from "@/lib/lead-finder/types";
import type { Radar } from "@/lib/lead-finder/radar";

import { PageTop } from "../parts";
import { alertBox, btnQuiet, mutedText, pageMain, pillLinkBase, pillLinkInfo, pillLinkQuiet } from "../ui";
import type { Words } from "../words";
import { FinderBox, type FinderActions } from "./FinderBox";
import { FinderRadar } from "./FinderRadar";
import { ProspectCards, type CardActions } from "./ProspectCards";

/**
 * The Lead Finder of app v4 (part 5, owner 7 Nov 2026, from app-Finder.png): the box that plans a search, then (wide screens) the radar and "how it decides" on the left and the shops it found on the right, one column on a phone: box,
 * radar, shops, then how it decides. Server markup (the page reads the data and hands it in); it lives here, not in the page, so that its classes are generated with the rest of components/v2.
 */
export function FinderV4({ lang, t, w, words, base, finder, around, radar, checked, total, stats, page, status, onlyId, gone, practiceOpen, admin, langNames, finderActions, cardActions }: { lang: string; t: AppT; w: Readonly<Record<string, string>>; words: Words; base: string; finder: Availability | null; around: string | null; radar: Radar | null; checked: { checked: number; worth: number } | null; total: number; stats: ProspectStats | null; page: ProspectPage | null; status: ProspectStatus | null; onlyId: string | null; gone: boolean; practiceOpen: string | null; admin: boolean; langNames: Record<CallLanguage, string>; finderActions: FinderActions; cardActions: CardActions }) {
  const href = (s: ProspectStatus | null) => (s ? `${base}/retailers?${new URLSearchParams({ status: s })}` : `${base}/retailers`);
  const count = (s: ProspectStatus) => stats?.byStatus[s];
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={w["nav.item.v4d-finder"]} sub={w["lf.v4.sub"]} />
      {finder?.source === "fixture" ? (
        <p role="note" className="mt-3 text-sm font-semibold text-info-text" data-demo="">
          {t("lf.demo")}
        </p>
      ) : null}
      {finder === null ? (
        <p role="alert" className={alertBox}>
          {t("lf.na")}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <FinderBox words={words} canApprove={admin} base={base} actions={finderActions} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start" data-part="finder-grid">
            {radar ? (
              <div className="lg:col-start-1 lg:row-start-1">
                <FinderRadar radar={radar} w={w} around={around} checked={checked} />
              </div>
            ) : null}
            <section aria-labelledby="fc-title" className="flex min-w-0 flex-col gap-3 rounded-[22px] border border-line bg-surface p-3.5 sm:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-part="finder-shops">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 id="fc-title" className="m-0 font-display text-xl font-bold">
                  {w["lf.v4.found"]}
                </h2>
                {page && page.items.length > 0 ? <span className="text-sm text-muted">{(w["lf.v4.of"] ?? "").replace("{n}", String(page.items.length)).replace("{m}", String(Math.max(total, page.items.length)))}</span> : null}
              </div>
              {onlyId ? (
                <p className="m-0 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted">{t(gone ? "lf.one.gone" : "lf.one")}</span>
                  <Link href={href(null)} className={btnQuiet}>
                    {t("lf.all")}
                  </Link>
                </p>
              ) : (
                <nav aria-label={t("lf.f.label")} className="flex flex-wrap gap-2" data-filter="">
                  {[null, ...STATUS_FILTER].map((s) => {
                    const n = s ? count(s) : stats?.total;
                    const word = s ? t(`lf.status.${s}`) : t("lf.f.all");
                    return (
                      <Link key={s ?? "all"} href={href(s)} aria-current={s === status ? "page" : undefined} className={`${pillLinkBase} ${s === status ? pillLinkInfo : pillLinkQuiet}`}>
                        {n !== undefined ? `${word} (${n})` : word}
                      </Link>
                    );
                  })}
                </nav>
              )}
              {page === null ? (
                <p role="alert" className={alertBox}>
                  {t("lf.na")}
                </p>
              ) : page.items.length === 0 ? (
                gone ? null : <p className={mutedText}>{t(status ? "lf.none.filter" : "lf.none")}</p>
              ) : (
                <ProspectCards items={page.items} words={w} base={base} canPractice={admin} canSearch={admin} practiceOpen={practiceOpen} labelFixture={finder.source !== "fixture"} langNames={langNames} actions={cardActions} />
              )}
              {page?.nextCursor ? (
                <p className="m-0">
                  <Link href={`${base}/retailers?${new URLSearchParams({ ...(status ? { status } : {}), cursor: page.nextCursor })}`} className={btnQuiet}>
                    {t("lf.more")}
                  </Link>
                </p>
              ) : null}
            </section>
            <section aria-label={w["lf.v4.s.label"]} className="grid gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-3 lg:col-start-1 lg:row-start-2" data-part="finder-rules">
              {(["1", "2", "3"] as const).map((n) => (
                <div key={n}>
                  <h3 className="m-0 font-display text-base font-bold">{w[`lf.v4.s${n}.t`]}</h3>
                  <p className="m-0 mt-1 text-sm text-muted">{w[`lf.v4.s${n}.b`]}</p>
                </div>
              ))}
            </section>
          </div>
          <p className={mutedText}>{t("lf.nocall")}</p>
        </div>
      )}
    </main>
  );
}
