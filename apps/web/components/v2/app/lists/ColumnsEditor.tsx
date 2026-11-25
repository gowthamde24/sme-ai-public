"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { BILLING_PERIODS, COLUMN_ROLES, COLUMN_TYPES, MAX_COLUMNS, type Column, type ColumnRole, type Done, type SellList } from "@/lib/lists/types";
import type { ColumnInput } from "@/lib/api/lists";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";

type Draft = { key: string | null; label: string; type: string; choices: string; role: ColumnRole | ""; billing: string; quote: boolean; open: boolean; uid: string };
const toDraft = (c: Column): Draft => ({ key: c.key, label: c.label, type: c.type, choices: c.choices.join(", "), role: c.role ?? "", billing: c.billingPeriod ?? "one_time", quote: c.quoteDefault, open: false, uid: crypto.randomUUID() });
const toInput = (d: Draft): ColumnInput => ({ ...(d.key ? { key: d.key } : {}), label: d.label.trim(), type: d.type, choices: d.type === "choice" ? d.choices.split(",").map((w) => w.trim()).filter((w) => w !== "").slice(0, 20) : [], role: d.role || null, billingPeriod: d.role === "price" ? d.billing : null, quoteDefault: d.role === "price" && d.quote });

/**
 * Edit columns (mock "Edit columns"): for each column its name, Type and Meaning as plain labelled fields, up and down buttons (a phone has no dragging), Remove; a price column also shows Billing and "Quote this price by default", a choice column its words. On a phone the extra
 * rows hide behind "More". Saving sends the WHOLE ordered set; a column that holds information asks "Hide it?" first and is sent again with the person's yes (the information is kept 30 days).
 */
export function ColumnsEditor({ list, words, back, save }: { list: SellList; words: Words; back: string; save: (columns: readonly ColumnInput[], confirm: boolean) => Promise<Done<SellList>> }) {
  const t = makeT(words);
  const router = useRouter();
  const [cols, setCols] = React.useState<Draft[]>(() => list.columns.map(toDraft));
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [needsYes, setNeedsYes] = React.useState(false);
  const set = (uid: string, patch: Partial<Draft>) => setCols((cur) => cur.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 1 || j >= cols.length || i < 1) return;
    setCols((cur) => {
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const go = async (confirm: boolean) => {
    setBusy(true);
    setProblem(null);
    // the first price column to quote by default: the one marked, else the first
    const prices = cols.filter((c) => c.role === "price");
    const marked = prices.some((c) => c.quote) ? prices.find((c) => c.quote)?.uid : prices[0]?.uid;
    const r = await save(cols.map((c) => toInput({ ...c, quote: c.role === "price" && c.uid === marked })), confirm);
    setBusy(false);
    if (r.ok) return router.push(back);
    if (r.error === "column_has_data") return setNeedsYes(true);
    setProblem(t(`wls.err.${r.error}` as "wls.err.unavailable"));
  };
  const id = (c: Draft, k: string) => `${c.uid}-${k}`;
  return (
    <div data-part="columns-editor" className="flex flex-col">
      <p className="m-0 border-y border-line py-3 text-[15px] text-muted">{t("wls.cols.hint")}</p>
      <ol className="m-0 mt-2 flex list-none flex-col border-t border-ink p-0">
        {cols.map((c, i) => (
          <li key={c.uid} data-column={c.key ?? "new"} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 border-b border-line py-4 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-end">
            <div className="flex gap-1 md:flex-col">
              <button type="button" disabled={i < 2} aria-label={t("wls.col.up")} onClick={() => move(i, -1)} className="grid size-10 place-items-center rounded-lg border border-edge disabled:opacity-40">
                ↑
              </button>
              <button type="button" disabled={i === 0 || i === cols.length - 1} aria-label={t("wls.col.down")} onClick={() => move(i, 1)} className="grid size-10 place-items-center rounded-lg border border-edge disabled:opacity-40">
                ↓
              </button>
            </div>
            <div className="flex min-w-0 flex-col">
              <label htmlFor={id(c, "l")} className={fieldLabel}>
                {t("wls.col.name")}
              </label>
              <input id={id(c, "l")} value={c.label} maxLength={40} disabled={i === 0} onChange={(e) => set(c.uid, { label: e.target.value })} className={fieldInput} />
            </div>
            <div className="col-start-2 flex min-w-0 flex-col md:col-start-auto">
              <label htmlFor={id(c, "t")} className={fieldLabel}>
                {t("wls.col.type")}
              </label>
              <select id={id(c, "t")} value={c.type} disabled={i === 0 || c.key !== null} onChange={(e) => set(c.uid, { type: e.target.value, role: e.target.value === "rupees" ? c.role : c.role === "price" ? "" : c.role })} className={fieldInput}>
                {COLUMN_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`wls.type.${x}` as "wls.type.text")}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-start-2 flex min-w-0 flex-col md:col-start-auto">
              <label htmlFor={id(c, "r")} className={fieldLabel}>
                {t("wls.col.meaning")}
              </label>
              <select id={id(c, "r")} value={c.role} disabled={i === 0} onChange={(e) => set(c.uid, { role: e.target.value as ColumnRole | "" })} className={fieldInput}>
                <option value="">{t("wls.role.none")}</option>
                {COLUMN_ROLES.filter((x) => x !== "price" || c.type === "rupees").map((x) => (
                  <option key={x} value={x}>
                    {t(`wls.role.${x}` as "wls.role.price")}
                  </option>
                ))}
              </select>
            </div>
            {i > 0 ? (
              <button type="button" onClick={() => setCols((cur) => cur.filter((x) => x.uid !== c.uid))} className="col-start-2 min-h-11 justify-self-start text-sm text-muted underline underline-offset-4 hover:text-ink md:col-start-auto">
                {t("wls.col.remove")}
              </button>
            ) : (
              <span />
            )}
            {c.role === "price" || c.type === "choice" ? (
              <>
                <button type="button" aria-expanded={c.open} onClick={() => set(c.uid, { open: !c.open })} className="col-start-2 min-h-11 justify-self-start text-sm text-muted underline underline-offset-4 md:hidden">
                  {c.open ? t("wls.col.fewer") : t("wls.col.more")}
                </button>
                <div className={`col-start-2 flex-col gap-3 md:col-span-4 md:col-start-2 md:flex md:flex-row md:flex-wrap md:items-end ${c.open ? "flex" : "hidden"}`}>
                  {c.role === "price" ? (
                    <>
                      <div className="flex flex-col">
                        <label htmlFor={id(c, "b")} className={fieldLabel}>
                          {t("wls.col.billing")}
                        </label>
                        <select id={id(c, "b")} value={c.billing} onChange={(e) => set(c.uid, { billing: e.target.value })} className={`${fieldInput} w-auto`}>
                          {BILLING_PERIODS.map((x) => (
                            <option key={x} value={x}>
                              {t(`wls.bill.${x}` as "wls.bill.one_time")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                        <input type="radio" name="wls-quote" checked={c.quote} onChange={() => setCols((cur) => cur.map((x) => ({ ...x, quote: x.uid === c.uid })))} className="size-5 accent-ink" />
                        {t("wls.col.quote")}
                      </label>
                    </>
                  ) : null}
                  {c.type === "choice" ? (
                    <div className="flex min-w-0 flex-1 flex-col">
                      <label htmlFor={id(c, "c")} className={fieldLabel}>
                        {t("wls.col.choices")}
                      </label>
                      <input id={id(c, "c")} value={c.choices} maxLength={400} onChange={(e) => set(c.uid, { choices: e.target.value })} className={fieldInput} />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={cols.length >= MAX_COLUMNS} onClick={() => setCols((cur) => [...cur, { key: null, label: "", type: "text", choices: "", role: "", billing: "one_time", quote: false, open: false, uid: crypto.randomUUID() }])} className={btnQuiet}>
          {t("wls.col.add")}
        </button>
        <span className="text-[14px] text-muted">{t("wls.cols.count", { n: cols.length, max: MAX_COLUMNS })}</span>
      </div>
      <p className="m-0 mt-4 border-y border-line py-3 text-[15px] text-muted">{t("wls.col.note")}</p>
      {needsYes ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-semibold text-ink">
          {t("wls.col.hide")}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || cols.some((c) => c.label.trim() === "")} onClick={() => void go(needsYes)} className={btnMain}>
          {busy ? t("wls.saving") : needsYes ? t("wls.col.hide.yes") : t("wls.col.save")}
        </button>
        <button type="button" onClick={() => router.push(back)} className={btnQuiet}>
          {t("wls.cancel")}
        </button>
      </div>
    </div>
  );
}
