import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import Link from "next/link";

import type { CallRow } from "@/lib/api/calls";
import { callClock, refuseWhy, splitCalls } from "@/lib/calls/view";

type W = Readonly<Record<string, string>>;
export type CallsListProps = { items: readonly CallRow[] | null; base: string; w: W; when: (iso: string) => string; language: (code: string) => string | null; olderHref: string | null };

/** What came of a finished call, in words: the category if there is one, else the result; a refused call says why, by its group. */
export function callResult(c: CallRow, w: W): string | null {
  if (c.state === "refused") return (w["ph.refused"] ?? "{why}").replace("{why}", w[`ph.why.${refuseWhy(c.refuseReason)}`] ?? "");
  if (c.category) return w[`outcome.cat.${c.category}`] ?? w[`ph.cat.${c.category}`] ?? null;
  if (c.outcome === "positive" || c.outcome === "negative" || c.outcome === "unclear") return w[`outcome.result.${c.outcome}`] ?? null;
  return null;
}

/**
 * Calls > Phone calls (app v4 part 4; GET /calls): the live calls first (ringing or on the line, with the time since they were answered), then the earlier ones, newest first: who, which way, what came of it, the short summary,
 * when and how long. Each row opens the call; a call that belongs to a customer also links to the customer's page. A "Test call" says so. Server markup; the page reads the list again while a call is live.
 */
export function CallsList({ items, base, w, when, language, olderHref }: CallsListProps) {
  if (items === null) return <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{w["ph.unread"]}</p>;
  if (items.length === 0) return <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{w["ph.none"]}</p>;
  const { live, earlier } = splitCalls(items);
  const row = (c: CallRow) => {
    const result = callResult(c, w);
    const lang = c.language ? language(c.language) : null;
    const Dir = c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
    return (
      <li key={c.id} data-call={c.id} data-live={c.live ? "1" : undefined} className={`relative flex gap-3 rounded-2xl border bg-surface p-3 ${c.live ? "border-brand-edge shadow-[0_0_0_3px_var(--v2-brand-bg)]" : "border-line"}`}>
        <span aria-hidden="true" className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full ${c.live ? "bg-[#ff773c] text-[#1e1e24]" : "bg-surface-2 text-muted"}`}>
          <Dir className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            {/* the whole row opens the call (the name is the link; the stretched area covers the row) */}
            <Link href={`${base}/calls/${c.id}`} className="font-semibold text-ink after:absolute after:inset-0 after:rounded-2xl [overflow-wrap:anywhere]">
              {c.who || w["ph.dir.inbound"]}
            </Link>
            <span className="text-xs tabular-nums text-muted">
              {c.live ? (
                <span className="font-bold text-brand-text">
                  ● {w[`ph.state.${c.state}`]}
                  {c.answeredAt ? ` · ${callClock(c.elapsedS)}` : ""}
                </span>
              ) : (
                <>
                  <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
                  {c.elapsedS > 0 ? ` · ${callClock(c.elapsedS)}` : ""}
                </>
              )}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{[w[`ph.dir.${c.direction}`], lang, !c.live && c.state !== "completed" && c.state !== "refused" ? w[`ph.state.${c.state}`] : null].filter(Boolean).join(" · ")}</span>
            {c.sandbox || c.simulated ? <span className="rounded-full bg-surface-2 px-2 font-bold">{w["ph.test"]}</span> : null}
          </span>
          {result ? <span className="mt-1 block text-sm font-semibold text-ink">{result}</span> : null}
          {c.summaryShort ? <span className="mt-0.5 block text-sm text-muted [overflow-wrap:anywhere]">{c.summaryShort}</span> : null}
          {c.leadId ? (
            <Link href={`${base}/customers/${c.leadId}`} className="relative z-10 mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-4" data-part="call-customer">
              {w["ph.customer"]}
            </Link>
          ) : null}
        </span>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-5" data-part="calls-list">
      {live.length ? (
        <section aria-labelledby="calls-live" className="flex flex-col gap-2">
          <h2 id="calls-live" className="m-0 font-display text-lg font-bold">
            {w["ph.live"]}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{live.map(row)}</ul>
        </section>
      ) : null}
      {earlier.length ? (
        <section aria-labelledby="calls-earlier" className="flex flex-col gap-2">
          <h2 id="calls-earlier" className="m-0 font-display text-lg font-bold">
            {w["ph.finished"]}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{earlier.map(row)}</ul>
        </section>
      ) : null}
      {olderHref ? (
        <Link href={olderHref} className="self-start text-sm font-semibold text-brand-text underline underline-offset-4">
          {w["ph.older"]}
        </Link>
      ) : null}
    </div>
  );
}
