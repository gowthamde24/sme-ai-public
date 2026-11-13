import Link from "next/link";
import type { ReactNode } from "react";

import { formatRupeesShort } from "@/lib/money";
import type { Estimate } from "@/lib/billing-v6/estimate";
import { CARD_STATUS, groupCards, progressOf, type CampaignCard } from "@/lib/campaigns-v6/cards";

import { EmptyNext } from "../ds/EmptyNext";
import { PageHeader } from "../ds/PageHeader";
import { StatusPill } from "../ds/StatusPill";
import { btnMain } from "../ui";
import { Meter } from "../v6/Meter";
import { card, cardQuiet, sectionTitle } from "../v6/ui";
import { makeT, type Words } from "../words";

import { BatchControls } from "./BatchControls";

export type CampaignsV6Props = {
  words: Words;
  /** The "?" (helpTipFor(lang, base, "campaigns", true)). */
  help: ReactNode;
  cards: readonly CampaignCard[];
  /** The estimate of each list that waits for the OK (by card id). */
  estimates: Readonly<Record<string, Estimate>>;
  /** "Mon to Sat, 09:00 to 19:00", or null when the calling hours could not be read. */
  hours: string | null;
  goalNames: Readonly<Record<string, string>>;
  /** Where "New campaign" goes; null = the person cannot make one. */
  newHref: string | null;
  /** Pause / resume for a list (the Owner and Admin); null where the person cannot. */
  control: ((id: string) => (action: "pause" | "resume") => Promise<{ ok: true } | { ok: false; error: string }>) | null;
  /** The page could not read its lists. */
  unavailable: boolean;
  mock: boolean;
  /** Drawn at the top of the page body, before the cards (e.g. the "calls are waiting for minutes" card). */
  top?: ReactNode;
  /** Where "Make a list" goes in the empty state. */
  emptyHref: string;
};

/**
 * The Campaigns page of design system v6 (owner 13 Nov 2026): the calling and WhatsApp lists, each as a card: lists that WAIT for the OK are plan cards (time, rupees, calling hours), lists that are going on show a progress bar, Pause and Undo, and lists that
 * are finished show what they brought (visits booked, quotes in rupees; for a reminder campaign what was paid after it). Nothing here sends or calls: the buttons are the page's own actions and the plan is approved on its own page.
 */
export function CampaignsV6({ words, help, cards, estimates, hours, goalNames, newHref, control, unavailable, mock, top = null, emptyHref }: CampaignsV6Props) {
  const t = makeT(words);
  const add = newHref ? (
    <Link href={newHref} className={btnMain}>
      {t("cv6.new")}
    </Link>
  ) : null;
  const header = <PageHeader title={t("cv6.title")} sub={t("cv6.sub")} right={<>{help}{add}</>} />;
  if (unavailable) {
    return (
      <div data-part="campaigns-v6">
        {header}
        <p className="mt-6 text-base text-muted">{t("cv6.na")}</p>
      </div>
    );
  }
  const groups = groupCards(cards);
  const facts = (c: CampaignCard): string => [t(`cv6.channel.${c.channel}`), c.goal ? (goalNames[c.goal] ?? null) : null, t("cv6.people", { n: c.people })].filter(Boolean).join(" · ");
  const results = (c: CampaignCard): ReactNode => {
    const r = c.results;
    const parts: string[] = [];
    if (r.visits !== null) parts.push(t("cv6.results.visits", { n: r.visits }));
    if (r.quotesPaise !== null) parts.push(t("cv6.results.quotes", { amount: formatRupeesShort(r.quotesPaise) }));
    if (r.paidPaise !== null) parts.push(t("cv6.results.paid", { amount: formatRupeesShort(r.paidPaise) }));
    if (parts.length === 0 && r.interested !== null) parts.push(t("cv6.results.interested", { n: r.interested }));
    return <p className="text-base font-semibold">{parts.length > 0 ? parts.join(" · ") : t("cv6.results.wait")}</p>;
  };
  const planCard = (c: CampaignCard) => {
    const est = estimates[c.id] ?? null;
    return (
      <li key={c.id} data-campaign={c.id} data-state={c.state} className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-lg font-semibold">{c.name}</h3>
          <StatusPill status={CARD_STATUS[c.state]}>{t(`cv6.state.${c.state}`)}</StatusPill>
        </div>
        <p className="mt-1 text-sm text-muted">{facts(c)}</p>
        {est ? (
          <dl data-part="plan" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className={cardQuiet}>
              <dt className="text-sm text-muted">{t("cv6.plan.time")}</dt>
              <dd className="font-semibold">{est.timeText}</dd>
            </div>
            <div className={cardQuiet}>
              <dt className="text-sm text-muted">{t("cv6.plan.cost")}</dt>
              <dd className="font-semibold">{est.costText}</dd>
            </div>
            <div className={cardQuiet}>
              <dt className="text-sm text-muted">{t("cv6.plan.hours")}</dt>
              <dd className="font-semibold">{hours ?? t("cv6.plan.hours.none")}</dd>
            </div>
          </dl>
        ) : null}
        {est && !est.enough ? (
          <p role="note" className="mt-2 text-sm font-semibold text-red-text">
            {est.shortfallText ?? t("cv6.plan.short")}
          </p>
        ) : null}
        <p className="mt-3">
          <Link href={c.href} className={btnMain}>
            {t(c.state === "draft" ? "cv6.open.draft" : "cv6.open.plan")}
          </Link>
        </p>
      </li>
    );
  };
  const progressCard = (c: CampaignCard) => {
    const p = progressOf(c);
    const live = c.state === "running" || c.state === "paused";
    return (
      <li key={c.id} data-campaign={c.id} data-state={c.state} className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-lg font-semibold">
            <Link href={c.href} className="text-brand-text hover:underline">
              {c.name}
            </Link>
          </h3>
          <StatusPill status={CARD_STATUS[c.state]}>{t(`cv6.state.${c.state}`)}</StatusPill>
        </div>
        <p className="mt-1 text-sm text-muted">{facts(c)}</p>
        <div className="mt-3">
          <Meter label={t("cv6.progress.label", { name: c.name })} value={p.value} max={p.max} text={t("cv6.progress", { done: p.value, total: p.max })} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {results(c)}
          {live && control && c.kind === "list" ? <BatchControls words={words} state={c.state === "paused" ? "paused" : "running"} pausedBy={c.pausedBy} control={control(c.id)} /> : null}
        </div>
      </li>
    );
  };
  const section = (id: string, items: readonly CampaignCard[], render: (c: CampaignCard) => ReactNode, sub?: string) =>
    items.length === 0 ? null : (
      <section key={id} aria-labelledby={`cv6-${id}`} data-part={id} className="mt-6">
        <h2 id={`cv6-${id}`} className={sectionTitle}>
          {t(`cv6.${id}.title`)}
        </h2>
        {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
        <ul className="mt-3 flex flex-col gap-3">{items.map(render)}</ul>
      </section>
    );
  return (
    <div data-part="campaigns-v6">
      {header}
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("cv6.mock")}
        </p>
      ) : null}
      {top}
      {cards.length === 0 ? (
        <div className="mt-8">
          <EmptyNext title={t("cv6.empty.title")} text={t("cv6.empty.text")} action={{ href: emptyHref, label: t("cv6.empty.action") }} />
        </div>
      ) : (
        <>
          {section("waiting", groups.waiting, planCard, t("cv6.waiting.sub"))}
          {section("active", groups.active, progressCard)}
          {section("finished", groups.finished, progressCard)}
        </>
      )}
    </div>
  );
}
