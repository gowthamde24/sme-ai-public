"use client";

import Link from "next/link";
import * as React from "react";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { formatRupeesShort } from "@/lib/money";

import { makeT, type Words } from "../words";

export type QuoteState = "waiting" | "approved" | "other";
export type QuoteOut = { quoteId: string; type: "quote" | "material_quote"; state: QuoteState; totalPaise: number | null };

const b1 = "inline-flex min-h-11 items-center justify-center rounded-[9px] bg-brand px-3 text-[13px] font-bold text-on-brand disabled:opacity-60";
const b2 = "inline-flex min-h-11 items-center justify-center rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2";

/**
 * The quote a call or a chat left behind, as a card (approved mock; used by the Calls panel and the Chats customer card): the amount big ("₹24,500"), with a small "Quote" label (Calls) or what it is for (Chats), "Change" (opens the quote) and the approve button (Owner and Admin,
 * second factor, through the existing quote approval; `approve` null = not drawn). In Calls it reads "Approve & send": approving sends NOTHING by itself; when it is approved, the quote's own "Open in WhatsApp" route opens WhatsApp with the words ready and the owner presses send there
 * (`go` = how the page navigates; the button stays as a link if the browser stays). In Chats it reads "Approve". The sentences are ours; no number is in this file.
 */
export function QuoteOutcome({ words, base, quote, approve, variant = "call", sub = null, go = (url) => window.location.assign(url) }: { words: Words; base: string; quote: QuoteOut; approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null; variant?: "call" | "chat"; sub?: string | null; go?: (url: string) => void }) {
  const t = makeT(words);
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "working" } | { kind: "ok"; message: string } | { kind: "err"; message: string; mfa: boolean }>({ kind: "idle" });
  const amount = quote.totalPaise !== null ? formatRupeesShort(quote.totalPaise) : null;
  const approved = quote.state === "approved" || state.kind === "ok";
  const waiting = quote.state === "waiting" && state.kind !== "ok";
  const kind = approved ? "approved" : quote.state === "waiting" ? "waiting" : "other";
  const whatsapp = `${base}/quotes/${quote.quoteId}/whatsapp`;
  return (
    <div className="flex flex-col gap-2.5" data-part="quote-outcome" data-state={kind}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface p-3">
        <div className="min-w-0">
          {variant === "call" ? <span className="inline-block rounded-full bg-brand-bg px-2 py-0.5 text-[11.5px] font-bold text-brand-text">{t(approved ? "calls6.quote.label.approved" : "calls6.quote.label")}</span> : null}
          {amount ? (
            <p className={`m-0 font-display font-bold tabular-nums ${variant === "call" ? "text-[22px] leading-tight" : "text-lg"}`}>{amount}</p>
          ) : (
            <p className="m-0 text-base font-semibold">{t(`calls6.quote.${kind}.plain`)}</p>
          )}
          {variant === "chat" ? <p className="m-0 text-xs text-muted">{approved ? t("calls6.quote.label.approved") : (sub ?? t("calls6.quote.label"))}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {waiting ? (
            <>
              {variant === "call" ? (
                <Link href={`${base}/quotes/${quote.quoteId}`} className={b2}>
                  {t("calls6.quote.change")}
                </Link>
              ) : null}
              {approve ? (
                <button
                  type="button"
                  disabled={state.kind === "working"}
                  className={b1}
                  onClick={async () => {
                    setState({ kind: "working" });
                    const r = await approve(quote.quoteId, quote.type).catch(() => ({ ok: false as const, error: t("today.err.generic") }));
                    setState(r.ok ? { kind: "ok", message: r.message } : { kind: "err", message: r.error, mfa: "mfa" in r && r.mfa === true });
                    if (r.ok && variant === "call" && quote.type === "quote") go(whatsapp);
                  }}
                >
                  {state.kind === "working" ? t("dta.btn.working") : t(variant === "call" ? "calls6.quote.approve" : "chats6.quote.approve")}
                </button>
              ) : null}
            </>
          ) : null}
          {approved && quote.type === "quote" ? (
            <a href={whatsapp} className={b1} data-part="quote-whatsapp">
              {t("calls6.quote.whatsapp")}
            </a>
          ) : null}
        </div>
      </div>
      {waiting || approved ? <p className="m-0 text-xs text-muted">{t("calls6.quote.note")}</p> : null}
      {state.kind === "ok" ? (
        <p role="status" className="m-0 text-sm font-semibold text-green-text">
          {state.message}
        </p>
      ) : null}
      {state.kind === "err" ? (
        <p role="alert" className="m-0 text-sm font-semibold text-red-text">
          {state.message}
          {state.mfa ? (
            <>
              {" "}
              <Link href="/app/security" className="underline">
                {t("calls6.quote.security")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
