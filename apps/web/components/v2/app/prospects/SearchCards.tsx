"use client";

import Link from "next/link";

import { resultNumbers, rupees, type Search } from "@/lib/lead-finder/types";

import { h3, muted, okLine, pillClass, primary, quiet } from "../cc/kit";
import { makeT, type Words } from "../words";

/**
 * The Lead Finder's two cards (docs/contracts/lead-finder.md sections 1, 1b and 2), drawn the same on the Prospects tab (FinderBox) and in the assistant's chat (today/ask/ChatFinderCard): the PLAN CARD (what, where, at most how
 * many, the cost, the searches left today; OK and Cancel) and the RESULT CARD ("Found 18 · 0 call-ready · 11 need you · 7 skipped", or the closed card of a failed or cancelled search). Presentational only: the parent asks the API.
 */

/** "Google Maps", next to anything that came from Google (the Places terms): never translated. */
export function GoogleMark() {
  return (
    <span className={pillClass("neutral")} data-attribution="">
      Google Maps
    </span>
  );
}

/** `onCancel` absent: no Cancel button (a salesperson in the chat, who cannot cancel a search). */
export function PlanCard({ search, words, canApprove, busy, onOk, onCancel }: { search: Search; words: Words; canApprove: boolean; busy: boolean; onOk: () => void; onCancel?: () => void }) {
  const t = makeT(words);
  const cost = rupees(search.estCostPaise);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3 sm:p-4" data-plan-card="">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={h3}>{t("lf.plan.title")}</h3>
        {search.provider === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}
        {search.attribution ? <GoogleMark /> : null}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base [&>dd]:min-w-0 [&>dd]:break-words [&>dt]:text-sm [&>dt]:font-semibold [&>dt]:text-muted">
        <dt>{t("lf.plan.query")}</dt>
        <dd>{search.query}</dd>
        <dt>{t("lf.plan.area")}</dt>
        <dd>{search.area ?? t("lf.plan.area.none")}</dd>
        <dt>{t("lf.plan.max")}</dt>
        <dd>{t("lf.plan.max.n", { n: search.maxResults })}</dd>
        <dt>{t("lf.plan.cost")}</dt>
        <dd className="tabular-nums">{search.costIsEstimate ? t("lf.plan.cost.estimate", { amount: cost }) : cost}</dd>
        {search.searchesLeftToday !== null ? (
          <>
            <dt>{t("lf.plan.left")}</dt>
            <dd className="tabular-nums">{search.searchesLeftToday}</dd>
          </>
        ) : null}
      </dl>
      {canApprove ? null : <p className={muted}>{t("lf.plan.owner")}</p>}
      {canApprove || onCancel ? (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <button type="button" disabled={busy} onClick={onOk} className={`${primary} write-ctl`} data-plan-ok="">
              {busy ? t("lf.working") : t("lf.plan.ok")}
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" disabled={busy} onClick={onCancel} className={quiet} data-plan-cancel="">
              {t("lf.plan.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** `demo`: say "Made-up businesses for the demo" on the card of a made-up search (the chat; the Prospects tab says it once on top). */
export function ResultCard({ search, words, base, demo = false }: { search: Search; words: Words; base: string; demo?: boolean }) {
  const t = makeT(words);
  if (search.state === "cancelled") return <p className={muted}>{t("lf.result.cancelled")}</p>;
  if (search.state === "failed") {
    return (
      <p role="alert" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
        {t("lf.result.failed")}
      </p>
    );
  }
  const n = resultNumbers(search);
  return (
    <div role="status" className={`${okLine} flex flex-col gap-2`} data-result-card="">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t("lf.result.title")}</strong>
        {demo && search.provider === "fixture" ? <span className={pillClass("info")}>{t("lf.demo")}</span> : null}
        {search.attribution ? <GoogleMark /> : null}
      </div>
      <p className="text-base">{t("lf.result.line", n)}</p>
      {n.needs_owner > 0 ? (
        <Link href={`${base}/retailers?status=needs_owner`} className="inline-flex min-h-11 items-center font-semibold underline">
          {t("lf.result.show")}
        </Link>
      ) : null}
    </div>
  );
}
