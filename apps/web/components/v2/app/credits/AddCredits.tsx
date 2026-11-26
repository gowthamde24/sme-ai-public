"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { CreditsFail, Order, TopupOptions } from "@/lib/api/credits";
import { payOrder } from "@/lib/credits/checkout";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";

type Actions = {
  create: (amountRupees: number) => Promise<{ ok: true; order: Order } | CreditsFail>;
  confirm: (orderId: string, paymentId: string, signature: string) => Promise<{ ok: true; addedText: string } | CreditsFail>;
  fail: (orderId: string, reason: "failed" | "dismissed" | "cancelled") => Promise<void>;
};

/** What the person sees for a whole-rupee amount: credits added, GST on top (rounded half up to the paisa) and the total, as three lines (the server prices the order; this is the preview). */
const preview = (rupees: number, pct: number): { added: number; gst: number; total: number } => {
  const paise = rupees * 100;
  const gst = Math.floor((paise * pct + 50) / 100);
  return { added: paise, gst, total: paise + gst };
};
const inr = (paise: number): string => {
  const r = Math.floor(paise / 100);
  const s = String(r);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `₹${rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},` : ""}${last3}${paise % 100 ? `.${String(paise % 100).padStart(2, "0")}` : ""}`;
};

/**
 * Add credits (mock "Add credits"; C1's docs/contracts/credits-topup.md): four amounts or another whole-rupee amount, credits + GST + total as three lines, then Razorpay's Checkout (or the faked payment on staging); after payment the top-up is confirmed once (the server checks the
 * signature) and the page is read again. A test or fake mode says so in one line. Every refusal is one plain sentence (`cr.err.*`). Owner only: the button is not drawn for anyone else.
 */
export function AddCredits({ options, words, actions, label }: { options: TopupOptions; words: Words; actions: Actions; label?: string }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rupees, setRupees] = React.useState(() => Math.round((options.presets[1]?.addedPaise ?? options.presets[0]?.addedPaise ?? 100000) / 100));
  const [custom, setCustom] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [line, setLine] = React.useState<{ text: string; tone: "ok" | "info" | "bad" } | null>(null);
  const sum = preview(rupees, options.gstPercent);
  const valid = Number.isInteger(rupees) && rupees >= options.customMin && rupees <= options.customMax;
  const pick = (r: number) => {
    setRupees(r);
    setCustom("");
    setLine(null);
  };
  const say = (e: CreditsFail["error"]) => t(`cr.err.${e === "mfa" ? "forbidden" : e}` as "cr.err.unavailable");
  const pay = async () => {
    if (!valid) return setLine({ text: t("cr.err.amount"), tone: "bad" });
    setBusy(true);
    setLine(null);
    const made = await actions.create(rupees);
    if (!made.ok) {
      setBusy(false);
      return setLine({ text: say(made.error), tone: "bad" });
    }
    const paid = await payOrder(made.order);
    if (!paid.ok) {
      void actions.fail(made.order.orderId, paid.reason === "closed" ? "dismissed" : "failed");
      setBusy(false);
      return setLine({ text: t(paid.reason === "closed" ? "cr.err.closed" : "cr.err.failed"), tone: paid.reason === "closed" ? "info" : "bad" });
    }
    setLine({ text: t("cr.waiting"), tone: "info" });
    const done = await actions.confirm(made.order.orderId, paid.paymentId, paid.signature);
    setBusy(false);
    if (!done.ok) return setLine({ text: say(done.error), tone: "bad" });
    setLine({ text: t("cr.paid", { added: done.addedText || inr(sum.added) }), tone: "ok" });
    router.refresh();
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnMain} data-part="add-credits">
        {label ?? t("cr.add")}
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={t("cr.sheet.title")} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface p-5 md:rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 font-display text-[22px] font-semibold">{t("cr.sheet.title")}</h2>
              <button type="button" onClick={() => setOpen(false)} className={btnQuiet}>
                {t("cr.sheet.close")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("cr.sheet.title")}>
              {options.presets.map((p) => {
                const r = Math.round(p.addedPaise / 100);
                return (
                  <button key={p.addedPaise} type="button" role="radio" aria-checked={custom === "" && rupees === r} onClick={() => pick(r)} className={`min-h-14 rounded-xl border px-2 py-2 text-[17px] font-bold text-ink ${custom === "" && rupees === r ? "border-ink shadow-[inset_0_0_0_1px_var(--v2-ink,currentColor)]" : "border-edge"}`}>
                    {p.addedText}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-col">
              <label htmlFor="cr-custom" className={fieldLabel}>
                {t("cr.sheet.custom", { min: options.customMin, max: options.customMax.toLocaleString("en-IN") })}
              </label>
              <input
                id="cr-custom"
                inputMode="numeric"
                value={custom}
                maxLength={7}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setCustom(v);
                  setLine(null);
                  if (v !== "") setRupees(Number(v));
                }}
                className={fieldInput}
              />
            </div>
            <dl className="m-0 mt-4 flex flex-col border-t border-ink" data-part="topup-sum">
              <div className="flex justify-between gap-4 border-b border-line py-3 text-[15px]">
                <dt className="font-semibold text-ink">{t("cr.sheet.you_get")}</dt>
                <dd className="m-0 text-muted">{valid ? inr(sum.added) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line py-3 text-[15px]">
                <dt className="font-semibold text-ink">{t("cr.sheet.gst", { p: options.gstPercent })}</dt>
                <dd className="m-0 text-muted">{valid ? inr(sum.gst) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-line py-3 text-[15px]">
                <dt className="font-semibold text-ink">{t("cr.sheet.total")}</dt>
                <dd className="m-0 font-bold text-ink">{valid ? inr(sum.total) : "—"}</dd>
              </div>
            </dl>
            {options.mode !== "live" ? (
              <p className="m-0 mt-3 border-b border-line pb-3 text-[15px] text-muted" data-part="test-mode">
                {t("cr.sheet.test")}
              </p>
            ) : null}
            {line ? (
              <p role={line.tone === "bad" ? "alert" : "status"} className={`m-0 mt-3 text-[15px] ${line.tone === "bad" ? "font-semibold text-ink" : "text-muted"}`}>
                {line.text}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy || !valid} onClick={() => void pay()} className={btnMain}>
                {t("cr.sheet.pay", { total: valid ? inr(sum.total) : "" })}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={btnQuiet}>
                {t("cr.sheet.close")}
              </button>
            </div>
            <p className="m-0 mt-3 text-[14px] text-muted">{t("cr.sheet.never")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
