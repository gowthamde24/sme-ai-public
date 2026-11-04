"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { resultNumbers, rupees, searchTextProblem, type Search } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, h3, help, muted, okLine, pillClass, primary, quiet, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";

export type FinderActions = {
  plan: (text: string) => Promise<Reply<Search>>;
  approve: (searchId: string) => Promise<Reply<Search>>;
  cancel: (searchId: string) => Promise<Reply<Search>>;
};

/** "Google Maps", next to anything that came from Google (the Places terms): never translated. */
export function GoogleMark() {
  return (
    <span className={pillClass("neutral")} data-attribution="">
      Google Maps
    </span>
  );
}

/**
 * The box on the Prospects tab (job lead-finder part D, contract sections 1 and 2): the owner's words ("find new retailers in Jayanagar") -> the PLAN CARD (what, where, at most how many, the cost, the searches left today) -> OK
 * (Owner, Admin) -> the RESULT CARD ("Found 18 · 0 call-ready · 11 need you · 7 skipped"). Nothing is searched before the OK; Cancel throws the plan away. A Sales member can plan and is told who can OK it.
 */
export function FinderBox({ words, canApprove, base, actions }: { words: Words; canApprove: boolean; base: string; actions: FinderActions }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [search, setSearch] = useState<Search | null>(null);

  async function run(step: () => Promise<Reply<Search>>, after?: (s: Search) => void) {
    setBusy(true);
    setFailure(null);
    let r: Reply<Search>;
    try {
      r = await step();
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setSearch(r.data);
    after?.(r.data);
  }
  function plan() {
    const p = searchTextProblem(text);
    setProblem(p ? t(p === "empty" ? "lf.find.empty" : "lf.find.too_long") : null);
    if (p) return;
    void run(() => actions.plan(text.trim()));
  }

  return (
    <section className={card} aria-labelledby={`${id}-title`} data-finder="">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          plan();
        }}
      >
        <label id={`${id}-title`} htmlFor={`${id}-text`} className={`${h2} block`}>
          {t("lf.find.label")}
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <input id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t("lf.find.placeholder")} aria-describedby={`${id}-help`} className={`${field} min-w-0 flex-1 basis-56`} />
          <button type="submit" disabled={busy} className={`${primary} write-ctl`}>
            {busy && !search ? t("lf.working") : t("lf.find.btn")}
          </button>
        </div>
        <p id={`${id}-help`} className={help}>
          {t("lf.find.help")}
        </p>
        {problem ? (
          <p role="alert" className="text-sm font-medium text-red-text">
            {problem}
          </p>
        ) : null}
      </form>
      <FailureNote failure={failure} words={words} />
      {search?.state === "planned" ? <PlanCard search={search} words={words} canApprove={canApprove} busy={busy} onOk={() => void run(() => actions.approve(search.id), () => router.refresh())} onCancel={() => (canApprove ? void run(() => actions.cancel(search.id)) : setSearch(null))} /> : null}
      {search && search.state !== "planned" ? <ResultCard search={search} words={words} base={base} /> : null}
    </section>
  );
}

function PlanCard({ search, words, canApprove, busy, onOk, onCancel }: { search: Search; words: Words; canApprove: boolean; busy: boolean; onOk: () => void; onCancel: () => void }) {
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
      <div className="flex flex-wrap items-center gap-2">
        {canApprove ? (
          <button type="button" disabled={busy} onClick={onOk} className={`${primary} write-ctl`} data-plan-ok="">
            {busy ? t("lf.working") : t("lf.plan.ok")}
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={onCancel} className={quiet}>
          {t("lf.plan.cancel")}
        </button>
      </div>
    </div>
  );
}

function ResultCard({ search, words, base }: { search: Search; words: Words; base: string }) {
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
