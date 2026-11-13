"use client";

import Link from "next/link";
import * as React from "react";

import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import { formatRupeesShort } from "@/lib/money";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

export type QuoteState = "waiting" | "approved" | "other";
export type QuoteOut = { quoteId: string; type: "quote" | "material_quote"; state: QuoteState; totalPaise: number | null };

/**
 * The quote a call or a chat left behind, as a card body (design system v6; used by the Calls panel and the Chats customer card): what it is ("Quote ready for your OK: ₹45,000"), "Change" (opens the quote) and "Approve" (Owner and Admin, second factor, through the
 * existing quote approval; `approve` null = not drawn). Approving sends NOTHING: afterwards "Open in WhatsApp" appears (the quote's own redirect route; the owner presses send in their own WhatsApp). The sentences are ours; no number is in this file.
 */
export function QuoteOutcome({ words, base, quote, approve }: { words: Words; base: string; quote: QuoteOut; approve: ((quoteId: string, type: string) => Promise<DecisionResult>) | null }) {
  const t = makeT(words);
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "working" } | { kind: "ok"; message: string } | { kind: "err"; message: string; mfa: boolean }>({ kind: "idle" });
  const amount = quote.totalPaise !== null ? formatRupeesShort(quote.totalPaise) : null;
  const approved = quote.state === "approved" || state.kind === "ok";
  const waiting = quote.state === "waiting" && state.kind !== "ok";
  const kind = approved ? "approved" : quote.state === "waiting" ? "waiting" : "other";
  return (
    <div className="flex flex-col gap-3" data-part="quote-outcome" data-state={kind}>
      <p className="m-0 text-base font-semibold text-ink">{t(`calls6.quote.${kind}${amount ? "" : ".plain"}`, { amount: amount ?? "" })}</p>
      <div className="flex flex-wrap gap-2">
        {waiting ? (
          <>
            <Link href={`${base}/quotes/${quote.quoteId}`} className={btnQuiet}>
              {t("calls6.quote.change")}
            </Link>
            {approve ? (
              <button
                type="button"
                disabled={state.kind === "working"}
                className={btnMain}
                onClick={async () => {
                  setState({ kind: "working" });
                  const r = await approve(quote.quoteId, quote.type).catch(() => ({ ok: false as const, error: t("today.err.generic") }));
                  setState(r.ok ? { kind: "ok", message: r.message } : { kind: "err", message: r.error, mfa: "mfa" in r && r.mfa === true });
                }}
              >
                {state.kind === "working" ? t("dta.btn.working") : t("calls6.quote.approve")}
              </button>
            ) : null}
          </>
        ) : null}
        {approved && quote.type === "quote" ? (
          <a href={`${base}/quotes/${quote.quoteId}/whatsapp`} className={btnMain} data-part="quote-whatsapp">
            {t("calls6.quote.whatsapp")}
          </a>
        ) : null}
      </div>
      {waiting || approved ? <p className="m-0 text-sm text-muted">{t("calls6.quote.note")}</p> : null}
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
