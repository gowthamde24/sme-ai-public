"use client";

import Link from "next/link";
import * as React from "react";

import { btnMain, btnQuiet } from "../ui";
import type { Say } from "../words";

export type CheckoutLine = { label: string; value: string; strong?: boolean };

/**
 * The checkout sheet (night 4, part F2): how paying will look (UPI or card), clearly a TEST. It asks for NO UPI ID and NO card number: the choices are only "UPI (test)", "Card (test)" and "Test: make this payment fail", and it
 * says in the first line that no money is taken. Payments stay fake until the owner opens the billing gates. The page that opens it keeps one purchase id for the whole time the sheet is open, so pressing Pay twice, or again after a
 * lost answer, never buys twice. Closed with Escape or Cancel; the first control gets focus.
 */
export function CheckoutSheet({ t, title, lines, payLabel, busy, error, done, onPay, onClose }: { t: Say; title: string; lines: readonly CheckoutLine[]; payLabel: string; busy: boolean; error: string | null; done: string | null; onPay: (method: "test_ok" | "test_declined") => void; onClose: () => void }) {
  const [method, setMethod] = React.useState<"upi" | "card" | "fail">("upi");
  const first = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    first.current?.focus();
  }, []);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" data-checkout>
      <div role="dialog" aria-modal="true" aria-labelledby="tu-pay-h" className="max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tu-pay-h" className="font-display text-xl font-semibold">
            {title}
          </h2>
          <span className="rounded-full border border-amber-text bg-amber-bg px-2.5 py-0.5 text-sm font-bold tracking-wide text-amber-text">{t("tu.pay.test")}</span>
        </div>
        <p role="note" className="mt-2 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
          {t("tu.pay.nomoney")}
        </p>
        {done ? (
          <>
            <p role="status" className="mt-4 rounded-lg border border-green-text bg-green-bg px-3 py-2 font-medium text-green-text">
              {done}
            </p>
            <div className="mt-4">
              <button type="button" className={btnMain} onClick={onClose}>
                {t("tu.pay.close")}
              </button>
            </div>
          </>
        ) : (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              onPay(method === "fail" ? "test_declined" : "test_ok");
            }}
          >
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-base tabular-nums">
              {lines.map((l) => (
                <React.Fragment key={l.label}>
                  <dt className={l.strong ? "font-semibold" : "text-muted"}>{l.label}</dt>
                  <dd className={l.strong ? "font-semibold" : ""}>{l.value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <fieldset className="mt-4">
              <legend className="mb-1 text-sm font-semibold">{t("tu.pay.method")}</legend>
              {(["upi", "card", "fail"] as const).map((m, i) => (
                <label key={m} className="flex min-h-11 items-center gap-3 text-base">
                  <input ref={i === 0 ? first : undefined} type="radio" name="tu-method" value={m} checked={method === m} onChange={() => setMethod(m)} className="size-6 shrink-0 accent-brand-text" />
                  {t(`tu.pay.${m}`)}
                </label>
              ))}
            </fieldset>
            <p className="mt-1 text-sm text-muted">{t("tu.pay.nodetails")}</p>
            {error ? (
              <p role="alert" className="mt-3 text-sm font-medium text-red-text">
                {error}{" "}
                {error === t("tu.err.mfa") ? (
                  <Link href="/app/security" className="font-semibold underline">
                    {t("tu.err.mfa.link")}
                  </Link>
                ) : null}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" className={btnMain} disabled={busy}>
                {busy ? t("tu.pay.paying") : payLabel}
              </button>
              <button type="button" className={btnQuiet} disabled={busy} onClick={onClose}>
                {t("tu.pay.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
