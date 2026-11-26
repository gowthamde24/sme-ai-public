"use client";

import { Check, X } from "lucide-react";

import { counts, restatus, type ImportRow, type RowStatus } from "@/lib/sell/sheet-parse";

import type { makeT } from "../words";

type T = ReturnType<typeof makeT>;

const TONE: Record<RowStatus, string> = {
  ok: "text-green-text",
  no_price: "text-amber-text",
  bad_price: "text-red-text",
  no_name: "text-red-text",
  duplicate: "text-muted",
  too_cheap: "text-red-text",
};
const field = "min-h-11 w-full min-w-0 rounded-xl border border-edge bg-surface px-3 text-[16px] text-ink";

/**
 * The preview of a price list before anything is added (saree shop, owner's walk of 26 Nov): every row the sheet gave, each with one plain status, the name and the price editable in place, a way to remove a row, and ONE button that adds the rows that are ready.
 * On a laptop a row is one line (name, price, status, remove); on a phone the same row stacks (name, then price and remove, then its status), so nothing is cut off. Nothing here saves: `onAdd` is the owner pressing the button.
 */
export function ImportTable({ listName, fillCategory, rows, added, file, cut, reading = null, unreadable = false, t, busy, progress, onRows, onAdd, onCancel }: { /** the owner's list the rows go into (none: the saree catalogue) */ listName?: string; /** into a list with a Category column: one choice given to the rows that have none */ fillCategory?: { label: string; none: string; choices: readonly string[]; value: string; onChange: (v: string) => void }; rows: ImportRow[]; added: ReadonlySet<string>; file: string; cut: boolean; /** how a photo or PDF was read (null = a sheet, read exactly) */ reading?: "ai_vision" | "text_layer" | null; unreadable?: boolean; t: T; busy: boolean; progress: { done: number; total: number } | null; onRows: (rows: ImportRow[]) => void; onAdd: () => void; onCancel: () => void }) {
  const c = counts(rows);
  const set = (id: string, patch: Partial<ImportRow>) => onRows(restatus(rows.map((r) => (r.id === id ? { ...r, ...patch, checked: true } : r)), added)); // (changing a row is looking at it: its "please check" flag goes)
  const unsure = (r: ImportRow) => r.status === "ok" && (r.confidence === "medium" || r.confidence === "low") && !r.checked;
  return (
    <div data-part="import" className="flex flex-col gap-3">
      {listName ? <p data-part="import-into" className="m-0 text-[15px] font-bold text-ink">{t("jobs.sell.imp.adding_to", { name: listName })}</p> : null}
      <p className="m-0 text-[15px] leading-snug text-ink">{t("jobs.sell.imp.found", { n: rows.length, file })}</p>
      <p data-part="import-counts" className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[14px] font-semibold">
        <span className="text-green-text">{t("jobs.sell.imp.ready", { n: c.ready })}</span>
        {c.fix > 0 ? <span className="text-amber-text">{t("jobs.sell.imp.fix", { n: c.fix })}</span> : null}
        {c.check > 0 ? <span className="text-amber-text">{t("jobs.sell.imp.checkn", { n: c.check })}</span> : null}
        {c.skipped > 0 ? <span className="text-muted">{t("jobs.sell.imp.skip", { n: c.skipped })}</span> : null}
      </p>
      {reading ? <p data-part="import-reading" className="m-0 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">{t(reading === "ai_vision" ? "jobs.sell.imp.vision" : "jobs.sell.imp.text")}</p> : null}
      {unreadable ? <p className="m-0 text-[14px] leading-snug text-amber-text">{t("jobs.sell.note.unreadable")}</p> : null}
      {fillCategory ? (
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">
          {fillCategory.label}
          <select value={fillCategory.value} disabled={busy} onChange={(e) => fillCategory.onChange(e.target.value)} className={field}>
            <option value="">{fillCategory.none}</option>
            {fillCategory.choices.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {cut ? <p className="m-0 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">{t("jobs.sell.imp.cut")}</p> : null}
      <ul data-part="import-rows" className="m-0 flex max-h-[52dvh] list-none flex-col divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface p-0 md:max-h-[58dvh]">
        {rows.map((r, i) => (
          <li key={r.id} data-row={r.status} data-unsure={unsure(r) ? "true" : undefined} className={`${unsure(r) ? "bg-[var(--jb-info-soft)] " : ""}grid grid-cols-[minmax(0,1fr)_7.25rem] items-center gap-x-2 gap-y-0.5 px-3 py-2 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,12rem)_auto] md:gap-y-0 ${r.status === "duplicate" ? "opacity-60" : ""}`}>
            <input value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} aria-label={t("jobs.sell.imp.name_of", { n: i + 1 })} placeholder={t("jobs.sell.imp.col.name")} maxLength={120} disabled={busy} className={field} />
            <label className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-muted">₹</span>
              <input value={r.priceText.replace(/^\s*(₹|rs\.?|inr)\s*/i, "")} onChange={(e) => set(r.id, { priceText: e.target.value })} aria-label={t("jobs.sell.imp.price_of", { n: i + 1 })} inputMode="decimal" maxLength={20} disabled={busy} className={`${field} pl-7`} />
            </label>
            <span data-part="row-status" className={`col-start-1 row-start-2 flex items-center gap-1.5 text-[14px] font-semibold leading-snug md:col-start-auto md:row-start-auto ${TONE[r.status]}`}>
              {r.status === "ok" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
              {t(`jobs.sell.imp.s.${r.status}`)}
              {r.note ? <span data-part="row-note" className="font-normal text-muted"> · {r.note}</span> : null}
              {unsure(r) && r.status === "ok" ? <span data-part="row-check"> · {t("jobs.sell.imp.check")}</span> : null}
            </span>
            <button type="button" aria-label={t("jobs.sell.imp.remove", { n: i + 1 })} disabled={busy} onClick={() => onRows(restatus(rows.filter((x) => x.id !== r.id), added))} className="col-start-2 row-start-2 grid size-11 place-items-center justify-self-end rounded-full text-muted hover:bg-surface-2 md:col-start-auto md:row-start-auto">
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {c.ready === 0 ? <p className="m-0 text-[14px] leading-snug text-muted">{t("jobs.sell.imp.none_ready")}</p> : <p className="m-0 text-[13.5px] leading-snug text-muted">{t("jobs.sell.imp.note")}</p>}
      <div className="flex flex-wrap gap-2.5">
        <button type="button" data-action="import-add" disabled={busy || c.ready === 0} onClick={onAdd} className="jb-press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-brand-edge bg-brand px-5 text-[16px] font-bold text-on-brand disabled:opacity-50">
          <Check aria-hidden="true" className="size-4" />
          {progress ? t("jobs.sell.imp.adding", { done: progress.done, total: progress.total }) : c.ready === 1 ? t("jobs.sell.imp.add.one") : t("jobs.sell.imp.add", { n: c.ready })}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="jb-press inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-surface px-5 text-[16px] font-semibold text-ink">
          {t("jobs.sell.imp.cancel")}
        </button>
      </div>
    </div>
  );
}
