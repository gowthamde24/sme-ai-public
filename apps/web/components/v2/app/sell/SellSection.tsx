"use client";

import { Camera, FileSpreadsheet, Mic, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

import { SAY_EXAMPLE } from "@/lib/sell/text";
import type { SellEntry, SellStyle } from "@/lib/sell/types";

import { makeT, type Words } from "../words";
import { LazyWork, loadWork } from "./LazyWork";
import { SellRowBody } from "./SellRow";
import type { ImportTarget, SellActions, Work } from "./types";

/** A list this long gets a search box (a saree shop has dozens). */
const SEARCH_FROM = 8;

type Way = { id: "say" | "photos" | "sheet"; icon: ReactNode; href: string | null };

/**
 * WHAT YOU SELL (JOBS, owner-approved mock r3-04): the three ways to fill it (Say it, Take photos, Import a sheet), then the list of the business's style. Only the Owner and an Admin (`actions`) see the buttons and tap a row; the others read.
 * The sheet that adds and changes an entry, and the "I understood" card, are ONE lazy chunk (`LazyWork`): this part ships only the buttons and the rows, so the route stays small. `paths` are the existing pages the buttons reuse in a real workspace (the catalogue's
 * photo page, the price list's import): a button with a path is a plain link.
 */
export function SellSection({ style, entries: first, words, base, actions, live, ownerPrice, paths, oldLinks, targets }: { /** the owner's own lists an import can go into */ targets?: ImportTarget[]; style: SellStyle; entries: SellEntry[]; words: Words; base: string; actions: SellActions | null; live: boolean; ownerPrice: boolean; paths: { photos: string | null; sheet: string | null }; oldLinks: readonly { href: string; word: "old" | "old_prices" }[] }) {
  const t = makeT(words);
  const [entries, setEntries] = useState(first);
  const [work, setWork] = useState<Work | null>(null);
  const [find, setFind] = useState("");
  const back = useRef<HTMLElement | null>(null);
  const needle = find.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;
  const open = (w: Work, from: HTMLElement | null) => {
    back.current = from;
    setWork(w);
  };
  const close = () => {
    setWork(null);
    requestAnimationFrame(() => back.current?.focus());
  };
  const saved = (e: SellEntry) =>
    setEntries((list) => {
      const i = list.findIndex((x) => x.id === e.id);
      if (i < 0) return [e, ...list];
      return list.map((x, k) => (k === i ? (e.style === "products" && x.style === "products" ? { ...e, photo: x.photo, keep: x.keep } : e) : x));
    });

  const removed = (id: string) => setEntries((list) => list.filter((x) => x.id !== id));

  const ways: Way[] = [
    { id: "say", icon: <Mic aria-hidden="true" className="size-5" />, href: null },
    { id: "photos", icon: <Camera aria-hidden="true" className="size-5" />, href: live && paths.photos ? `${base}${paths.photos}` : null },
    { id: "sheet", icon: <FileSpreadsheet aria-hidden="true" className="size-5" />, href: live && paths.sheet ? `${base}${paths.sheet}` : null },
  ];
  const card = "jb-press flex min-h-[88px] flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3 text-left no-underline shadow-[var(--v2-shadow)] md:flex-row md:gap-3 md:p-3.5";

  return (
    <div data-part="what-you-sell" data-sell-kind={style} className="mt-4 flex flex-col gap-5">
      {actions ? (
        <section aria-labelledby="sell-fill" data-part="fill" className="flex flex-col gap-2.5">
          <h2 id="sell-fill" className="m-0 font-display text-[18px] font-bold leading-tight text-ink">
            {t("jobs.sell.fill.title")}
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {ways.map((w) => {
              const inner = (
                <>
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center text-ink">
                    {w.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold leading-snug text-ink md:text-[16px]">{t(`jobs.sell.${w.id}.title`)}</span>
                    <span className="hidden text-[13.5px] leading-snug text-muted md:block">{w.id === "say" ? t("jobs.sell.say.sub", { example: SAY_EXAMPLE[style] }) : t(`jobs.sell.${w.id}.sub`)}</span>
                  </span>
                </>
              );
              return w.href ? (
                <Link key={w.id} href={w.href} prefetch={false} data-way={w.id} className={card}>
                  {inner}
                </Link>
              ) : (
                <button key={w.id} type="button" data-way={w.id} aria-haspopup="dialog" onPointerEnter={() => void loadWork()} onFocus={() => void loadWork()} onTouchStart={() => void loadWork()} onClick={(e) => open(w.id === "say" ? { kind: "say" } : { kind: "read", from: w.id }, e.currentTarget)} className={card}>
                  {inner}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="sell-list" data-part="list" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sell-list" className="m-0 flex items-center gap-2 font-display text-[20px] font-bold leading-tight text-ink">
            {t(`jobs.sell.style.${style}.title`)}
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] font-semibold text-muted">{entries.length}</span>
          </h2>
          {actions ? (
            <button type="button" data-action="add" aria-haspopup="dialog" onPointerEnter={() => void loadWork()} onFocus={() => void loadWork()} onTouchStart={() => void loadWork()} onClick={(e) => open({ kind: "add" }, e.currentTarget)} className="jb-press inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-edge bg-brand px-4 text-[15px] font-bold text-on-brand">
              <Plus aria-hidden="true" className="size-4" />
              {t(`jobs.sell.style.${style}.add`)}
            </button>
          ) : null}
        </div>
        <p className="m-0 text-[14px] leading-snug text-muted">{t(`jobs.sell.style.${style}.for`)}</p>
        {entries.length >= SEARCH_FROM ? (
          <input type="search" data-part="find" value={find} onChange={(e) => setFind(e.target.value)} aria-label={t("jobs.sell.search")} placeholder={t("jobs.sell.search")} autoComplete="off" className="min-h-11 w-full rounded-xl border border-edge bg-surface px-3.5 text-[16px] text-ink" />
        ) : null}
        {entries.length === 0 ? (
          <p data-part="empty" className="m-0 rounded-2xl border border-dashed border-edge px-4 py-6 text-center text-[15px] text-muted">
            {t("jobs.sell.empty")}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface p-0 shadow-[var(--v2-shadow)]">
            {shown.length === 0 ? <li data-part="no-match" className="px-4 py-5 text-center text-[15px] text-muted">{t("jobs.sell.nomatch")}</li> : null}
            {shown.map((e) => (
              <li key={e.id} data-entry={e.id}>
                {actions ? (
                  <button type="button" aria-haspopup="dialog" onPointerEnter={() => void loadWork()} onClick={(ev) => open({ kind: "edit", entry: e }, ev.currentTarget)} className="jb-press flex min-h-14 w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left">
                    <SellRowBody entry={e} t={t} />
                  </button>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                    <SellRowBody entry={e} t={t} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {oldLinks.map((o) => (
          <p key={o.href} className="m-0 text-[14px]">
            <Link href={o.href} prefetch={false} data-part="old-page" className="font-semibold text-brand-text underline underline-offset-4">
              {t(`jobs.sell.${o.word}`)}
            </Link>
          </p>
        ))}
      </section>

      {work && actions ? <LazyWork style={style} work={work} words={words} base={base} actions={actions} live={live} ownerPrice={ownerPrice} paths={paths} targets={targets} onClose={close} onSaved={saved} onRemoved={removed} /> : null}
    </div>
  );
}
