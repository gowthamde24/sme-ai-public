"use client";

import Link from "next/link";
import * as React from "react";

import type { CreditsFail, Statement as StatementData, StatementItem } from "@/lib/api/credits";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

/** The statement (mock "Credits and billing"): newest first, hairline rows (what, when, the amount added or taken, the balance after, the invoice for a top-up); "Show earlier" reads the next 20. */
export function Statement({ first, words, base, load }: { first: StatementData; words: Words; base: string; load: (before: string) => Promise<{ ok: true; statement: StatementData } | CreditsFail> }) {
  const t = makeT(words);
  const [items, setItems] = React.useState<readonly StatementItem[]>(first.items);
  const [next, setNext] = React.useState<string | null>(first.hasMore ? first.nextBefore : null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  if (items.length === 0) return <p className="m-0 border-y border-line py-4 text-[15px] text-muted">{t("cr.statement.none")}</p>;
  return (
    <div data-part="statement">
      <ul className="m-0 flex list-none flex-col border-t border-ink p-0">
        {items.map((i, n) => (
          <li key={`${i.at}-${n}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-line py-3">
            <b className="text-[16px] font-semibold text-ink">{i.label}</b>
            <span className={`text-right text-[16px] font-bold ${i.amountPaise < 0 ? "text-ink" : "text-ink"}`}>{i.amountPaise > 0 ? `+ ${i.amountText}` : i.amountPaise < 0 ? `− ${i.amountText.replace(/^-/, "")}` : i.amountText}</span>
            <small className="text-[14px] text-muted">
              {when(i.at)} · {t(`cr.kind.${i.kind}` as "cr.kind.credit")}
              {i.invoiceNumber ? (
                <>
                  {" · "}
                  <Link href={`${base}/billing/invoices/${i.invoiceNumber}`} className="font-semibold text-ink underline underline-offset-2">
                    {t("cr.invoice", { n: i.invoiceNumber })}
                  </Link>
                </>
              ) : null}
            </small>
            <small className="text-right text-[14px] text-muted">{i.balanceAfterText}</small>
          </li>
        ))}
      </ul>
      {problem ? (
        <p role="alert" className="m-0 mt-2 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      {next ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await load(next);
            setBusy(false);
            if (r.ok) {
              setItems((cur) => [...cur, ...r.statement.items]);
              setNext(r.statement.hasMore ? r.statement.nextBefore : null);
            } else setProblem(t("cr.err.unavailable"));
          }}
          className={`${btnQuiet} mt-3`}
        >
          {t("cr.more")}
        </button>
      ) : null}
    </div>
  );
}
