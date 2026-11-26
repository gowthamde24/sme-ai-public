"use client";

import Link from "next/link";
import * as React from "react";

import { parseRupees, priceColumns, rupees, type Cell, type Column, type Done, type Row, type RowPage, type SellList } from "@/lib/lists/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { cardBox } from "../Card";

export type ListActions = {
  load: (q: string, cursor: string | null) => Promise<Done<RowPage>>;
  save: (rowId: string, input: { name: string; cells: Record<string, unknown>; active: boolean }, rupeeKeys: readonly string[]) => Promise<Done<Row>>;
  remove: (rowId: string) => Promise<Done<true>>;
};
type Say = ReturnType<typeof makeT>;

/** The desktop grid of a row for 0 to 11 further columns (static class names: Tailwind reads them, and no inline style is needed). */
const GRID = ["md:grid-cols-[minmax(0,1fr)]", "md:grid-cols-[minmax(0,1.6fr)_repeat(1,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(6,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(7,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(8,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(9,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(10,minmax(0,1fr))]", "md:grid-cols-[minmax(0,1.6fr)_repeat(11,minmax(0,1fr))]"] as const;

/** One cell as words: rupees with the price column's billing period ("₹299 per month", "from ₹5,000"), yes or no, else the text. */
export function cellText(col: Column, v: Cell | undefined, t: Say): string {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "rupees" && typeof v === "number") {
    const money = rupees(v);
    const p = col.role === "price" ? (col.billingPeriod ?? "one_time") : "one_time";
    return p === "one_time" ? money : p === "from" ? `${t("wls.bill.from")} ${money}` : `${money} ${t(`wls.bill.${p}` as "wls.bill.per_month")}`;
  }
  if (col.type === "yes_no") return v === true ? t("wls.row.yes") : "";
  if (col.type === "duration" && typeof v === "number") return `${v} ${t("wls.row.minutes")}`;
  return String(v);
}

/**
 * One list as a table (owner's idea, 29 Nov 2026; mock "What you sell" lists): search, a dropdown filter for each choice column, a Sort, hairline rows (on a phone each row stacks as "column: value"), Add an item and tap a row to change it. Prices are the Owner's
 * alone to change (an Admin sees them read-only); every refusal is a closed word drawn as a plain sentence.
 */
export function ListView({ list, initial, owner, canEdit, words, base, actions }: { list: SellList; initial: RowPage; owner: boolean; canEdit: boolean; words: Words; base: string; actions: ListActions }) {
  const t = makeT(words);
  const [rows, setRows] = React.useState<readonly Row[]>(initial.items);
  const [cursor, setCursor] = React.useState<string | null>(initial.nextCursor);
  const [q, setQ] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [sort, setSort] = React.useState("new");
  const [grouped, setGrouped] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [fresh, setFresh] = React.useState<string>("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const name0 = list.columns[0];
  const cols = list.columns.filter((c) => c !== name0 && c.type !== "photo");
  const choiceCols = cols.filter((c) => c.type === "choice" && c.key).sort((a, b) => Number(b.role === "category") - Number(a.role === "category"));
  const category = choiceCols.find((c) => c.role === "category");
  const price = priceColumns(list).find((c) => c.quoteDefault) ?? priceColumns(list)[0];
  const say = (code: string) => t(`wls.err.${code}` as "wls.err.unavailable");

  // the rows to draw (cheap: at most a few hundred loaded rows)
  const kept = rows.filter((r) => choiceCols.every((c) => !filters[c.key as string] || r.cells[c.key as string] === filters[c.key as string]));
  const sorted = sort === "az" ? [...kept].sort((a, b) => a.name.localeCompare(b.name)) : sort === "price" && price?.key ? [...kept].sort((a, b) => Number(a.cells[price.key as string] ?? Infinity) - Number(b.cells[price.key as string] ?? Infinity)) : kept;
  // grouped by the Category column: the column's words in their order, items with no word last
  const groupOf = (r: Row): string => (category ? String(r.cells[category.key as string] ?? "") : "");
  const rank = (r: Row): number => (groupOf(r) === "" ? 9999 : Math.max(0, category?.choices.indexOf(groupOf(r)) ?? 0));
  const shown = grouped && category ? sorted.map((r, k) => ({ r, k })).sort((a, b) => rank(a.r) - rank(b.r) || a.k - b.k).map((x) => x.r) : sorted;

  const search = async (text: string) => {
    setBusy(true);
    const r = await actions.load(text, null);
    setBusy(false);
    if (r.ok) {
      setRows(r.data.items);
      setCursor(r.data.nextCursor);
      setProblem(null);
    } else setProblem(say(r.error));
  };
  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    const r = await actions.load(q, cursor);
    setBusy(false);
    if (r.ok) {
      setRows((cur) => [...cur, ...r.data.items]);
      setCursor(r.data.nextCursor);
    } else setProblem(say(r.error));
  };
  const open = (id: string) => {
    setProblem(null);
    setEditing(id);
  };
  const addItem = () => {
    setFresh(crypto.randomUUID());
    open("new");
  };
  const saved = (row: Row) => {
    setRows((cur) => (cur.some((r) => r.id === row.id) ? cur.map((r) => (r.id === row.id ? row : r)) : [row, ...cur]));
    setEditing(null);
  };
  const removed = (id: string) => {
    setRows((cur) => cur.filter((r) => r.id !== id));
    setEditing(null);
  };

  return (
    <div data-part="list-view" className={`${cardBox} flex flex-col`}>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <button type="button" onClick={addItem} className={btnMain}>
            {t("wls.add_item")}
          </button>
        ) : null}
        {canEdit ? (
          <Link href={`${base}/columns`} className={btnQuiet}>
            {t("wls.edit_columns")}
          </Link>
        ) : null}
      </div>
      <form
        role="search"
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <input type="search" aria-label={t("wls.search")} value={q} placeholder={t("wls.search")} maxLength={80} onChange={(e) => setQ(e.target.value)} className={`${fieldInput} flex-1`} />
        <button type="submit" disabled={busy} className={btnQuiet}>
          {t("wls.search")}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {choiceCols.map((c) =>
          c.choices.length <= 12 ? (
            // a filter chip row: All, then each word of the column (the Category column first); a pressed chip filters the loaded items
            <div key={c.key} role="group" aria-label={c.label} data-part="chips" className="flex flex-wrap gap-2">
              {["", ...c.choices].map((w) => (
                <button key={w || "all"} type="button" aria-pressed={(filters[c.key as string] ?? "") === w} onClick={() => setFilters((f) => ({ ...f, [c.key as string]: w }))} className={`min-h-11 rounded-md border px-4 text-[15px] font-semibold ${(filters[c.key as string] ?? "") === w ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-ink"}`}>
                  {w === "" ? t("wls.all", { name: c.label }) : w}
                </button>
              ))}
            </div>
          ) : (
            <select key={c.key} aria-label={c.label} value={filters[c.key as string] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key as string]: e.target.value }))} className={`${fieldInput} w-auto`}>
              <option value="">{t("wls.all", { name: c.label })}</option>
              {c.choices.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          ),
        )}
        {category ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-ink">
            <input type="checkbox" data-action="group" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="size-5" />
            {t("wls.group", { name: category.label })}
          </label>
        ) : null}
        <select aria-label={t("wls.sort")} value={sort} onChange={(e) => setSort(e.target.value)} className={`${fieldInput} w-auto`}>
          <option value="new">{t("wls.sort.new")}</option>
          <option value="az">{t("wls.sort.az")}</option>
          {price ? <option value="price">{t("wls.sort.price", { name: price.label })}</option> : null}
        </select>
      </div>
      {problem ? (
        <p role="alert" className="m-0 mt-3 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      <ul className="m-0 mt-4 flex list-none flex-col border-t border-line p-0" data-part="rows">
        {editing === "new" ? (
          <li className="border-b border-line">
            <RowEditor key={fresh} rowId={fresh} row={null} list={list} owner={owner} t={t} actions={actions} onDone={saved} onCancel={() => setEditing(null)} onRemoved={removed} />
          </li>
        ) : null}
        {shown.map((r, i) => (
          <React.Fragment key={r.id}>
            {grouped && category && (i === 0 || groupOf(r) !== groupOf(shown[i - 1])) ? (
              <li data-group={groupOf(r)} className="border-b border-line bg-surface-2 px-1 py-2 text-[14px] font-bold text-muted">
                {groupOf(r) === "" ? t("wls.group.none") : groupOf(r)}
              </li>
            ) : null}
          <li data-row={r.id} className="border-b border-line">
            {editing === r.id ? (
              <RowEditor rowId={r.id} row={r} list={list} owner={owner} t={t} actions={actions} onDone={saved} onCancel={() => setEditing(null)} onRemoved={removed} />
            ) : (
              <button type="button" disabled={!canEdit} onClick={() => open(r.id)} className={`grid w-full grid-cols-2 gap-x-4 gap-y-1 py-3 text-left disabled:cursor-default ${GRID[Math.min(cols.length, 11)]}`}>
                <b className="col-span-2 text-[17px] font-semibold text-ink md:col-span-1">{r.name}</b>
                {cols.map((c) => {
                  const v = r.cells[c.key as string];
                  const text = cellText(c, v, t);
                  const missing = c.role === "price" && text === "";
                  return (
                    <span key={c.key} className="min-w-0 text-[15px] text-ink">
                      <small className="block text-[13px] font-semibold text-muted md:hidden">{c.label}</small>
                      {missing ? <span className="font-semibold text-brand-text">{owner ? t("wls.price.add") : t("wls.price.none")}</span> : text}
                    </span>
                  );
                })}
              </button>
            )}
          </li>
          </React.Fragment>
        ))}
      </ul>
      {shown.length === 0 && editing !== "new" ? <p className="m-0 mt-4 text-[15px] text-muted">{t("wls.none")}</p> : null}
      {cursor ? (
        <button type="button" disabled={busy} onClick={() => void more()} className="mt-3 self-start text-sm text-muted underline underline-offset-4">
          {t("wls.more")}
        </button>
      ) : null}
    </div>
  );
}

function RowEditor({ rowId, row, list, owner, t, actions, onDone, onCancel, onRemoved }: { rowId: string; row: Row | null; list: SellList; owner: boolean; t: Say; actions: ListActions; onDone: (r: Row) => void; onCancel: () => void; onRemoved: (id: string) => void }) {
  const cols = list.columns.slice(1).filter((c) => c.type !== "photo");
  const [name, setName] = React.useState(row?.name ?? "");
  const [active, setActive] = React.useState(row?.active ?? true);
  const [cells, setCells] = React.useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const c of cols) {
      const v = row?.cells[c.key as string];
      init[c.key as string] = c.type === "yes_no" ? v === true : c.type === "rupees" && typeof v === "number" ? String(v / 100) : v === null || v === undefined ? "" : String(v);
    }
    return init;
  });
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [fieldsBad, setFieldsBad] = React.useState<readonly string[]>([]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") return setProblem(t("wls.err.validation_error"));
    for (const c of cols) if (c.type === "rupees" && owner && String(cells[c.key as string]).trim() !== "" && parseRupees(String(cells[c.key as string])) === null) return (setFieldsBad([c.key as string]), setProblem(t("wls.err.not_a_price")));
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      const v = cells[c.key as string];
      out[c.key as string] = c.type === "number" || c.type === "duration" ? (String(v).trim() === "" ? null : Number(v)) : v;
    }
    setBusy(true);
    const r = await actions.save(rowId, { name, cells: out, active }, list.columns.filter((c) => c.type === "rupees").map((c) => c.key as string));
    setBusy(false);
    if (r.ok) onDone(r.data);
    else {
      setFieldsBad(r.fields ?? []);
      setProblem(t(`wls.err.${r.error}` as "wls.err.unavailable"));
    }
  };
  const id = (k: string) => `${rowId}-${k}`;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 py-4" data-part="row-editor">
      <div className="flex flex-col gap-1">
        <label htmlFor={id("name")} className={fieldLabel}>
          {t("wls.row.name")}
        </label>
        <input id={id("name")} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={fieldInput} />
      </div>
      {cols.map((c) => {
        const k = c.key as string;
        const readonly = c.type === "rupees" && !owner;
        const bad = fieldsBad.includes(k);
        return (
          <div key={k} className="flex flex-col gap-1">
            {c.type === "yes_no" ? (
              <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
                <input type="checkbox" checked={cells[k] === true} onChange={(e) => setCells((s) => ({ ...s, [k]: e.target.checked }))} className="size-5 accent-ink" />
                {c.label}
              </label>
            ) : (
              <>
                <label htmlFor={id(k)} className={fieldLabel}>
                  {c.label}
                  {c.role === "price" ? ` (${t(`wls.bill.${c.billingPeriod ?? "one_time"}` as "wls.bill.one_time")})` : ""}
                </label>
                {c.type === "choice" ? (
                  <select id={id(k)} value={String(cells[k])} onChange={(e) => setCells((s) => ({ ...s, [k]: e.target.value }))} className={fieldInput}>
                    <option value="">{t("wls.row.choose")}</option>
                    {c.choices.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id(k)}
                    value={String(cells[k])}
                    disabled={readonly}
                    aria-invalid={bad ? true : undefined}
                    inputMode={c.type === "number" || c.type === "duration" || c.type === "rupees" ? "decimal" : undefined}
                    type={c.type === "date" ? "date" : c.type === "datetime" ? "datetime-local" : c.type === "link" ? "url" : "text"}
                    maxLength={200}
                    onChange={(e) => setCells((s) => ({ ...s, [k]: e.target.value }))}
                    className={`${fieldInput} aria-[invalid=true]:border-ink`}
                  />
                )}
                {readonly ? <small className="text-[14px] text-muted">{t("wls.row.price_owner")}</small> : null}
              </>
            )}
          </div>
        );
      })}
      <label className="flex min-h-11 items-center gap-3 text-[15px] text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-ink" />
        {t("wls.row.active")}
      </label>
      {problem ? (
        <p role="alert" className="m-0 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnMain}>
          {busy ? t("wls.saving") : t("wls.save")}
        </button>
        <button type="button" onClick={onCancel} className={btnQuiet}>
          {t("wls.cancel")}
        </button>
        {row ? (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              const r = await actions.remove(row.id);
              setBusy(false);
              if (r.ok) onRemoved(row.id);
              else setProblem(t(`wls.err.${r.error}` as "wls.err.unavailable"));
            }}
            className="ml-auto min-h-11 text-sm text-muted underline underline-offset-4"
          >
            {t("wls.row.remove")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
