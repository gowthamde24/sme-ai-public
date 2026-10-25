import Link from "next/link";

import type { MaterialItemSummaryOut } from "@contracts";

import { FreshPhotos } from "../catalogue/FreshPhotos";
import { Photo } from "../catalogue/Photo";
import { AgentMark } from "../mark/AgentMark";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { badge, card, primary, secondary } from "../visits/styles";
import { badgesOf, perUnit, soonest } from "./mat-logic";

const BADGE_TONE = { inactive: "bg-surface-2 text-ink border border-edge", few_left: "bg-amber-bg text-amber-text", made_to_order: "bg-info-bg text-info-text" } as const;

export type ProductsViewProps = {
  help?: React.ReactNode;
  base: string;
  words: TodayWords;
  role: Role;
  /** null = the products could not be read. */
  items: readonly MaterialItemSummaryOut[] | null;
  more: string | null;
  inStockOnly: boolean;
};

/** The products of a business that sells building materials (job CO): a photo grid with the price per unit, the stock state and what a product lacks. Owner and Admin also see the hidden ones and can add a product. */
export function ProductsView({ base, words, role, items, more, inStockOnly, help }: ProductsViewProps) {
  const admin = role === "owner" || role === "admin";
  const first = items !== null && items.length === 0 && !inStockOnly;
  const toggle = inStockOnly ? base + "/materials" : base + "/materials?stock=1";
  return (
    <FreshPhotos seconds={items ? soonest(items) : null}>
      <div data-screen="products" className="flex flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.sarees")}</h1>
            <p className="text-base text-muted">{say(words, "mat.products.sub")}</p>
          </div>
          {admin && !first ? (
            <Link href={`${base}/materials/new`} className={primary}>
              {say(words, "mat.products.add")}
            </Link>
          ) : null}
        </header>
        {help}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={toggle} data-chip={inStockOnly ? "on" : "off"} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base ${inStockOnly ? "border-brand-edge bg-brand-bg font-semibold text-brand-text" : "border-edge font-medium text-ink hover:bg-surface-2"}`}>
            {say(words, "mat.products.instock")}
          </Link>
          {admin ? (
            <Link href={`${base}/data/import`} className={secondary}>
              {say(words, "mat.products.import")}
            </Link>
          ) : null}
        </div>
        {items === null ? (
          <div role="alert" className={`${card} flex-row items-center`} data-state="error">
            <AgentMark px={56} mood="resting" className="size-14" />
            <div>
              <p className="font-semibold">{say(words, "frame.notyet")}</p>
              <p className="text-sm text-muted">{say(words, "mat.products.error")}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className={`${card} items-start`} data-state={inStockOnly ? "nomatch" : "empty"}>
            <div className="flex items-center gap-3">
              <AgentMark px={64} mood="idle" className="size-16" />
              <h2 className="font-display text-2xl font-bold leading-tight">{say(words, inStockOnly ? "mat.products.nomatch" : "mat.products.empty.title")}</h2>
            </div>
            {inStockOnly ? null : <p className="text-base text-muted">{say(words, admin ? "mat.products.empty.admin" : "mat.products.empty.other")}</p>}
            {admin && !inStockOnly ? (
              <Link href={`${base}/materials/new`} className={primary}>
                {say(words, "mat.products.add")}
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-grid="items">
              {items.map((item, i) => (
                <li key={item.id} className="min-w-0">
                  <Link href={`${base}/materials/${item.id}`} data-item={item.id} data-hidden={item.active ? undefined : "true"} className={`flex h-full min-h-11 flex-col overflow-hidden rounded-2xl border bg-surface hover:border-brand-edge ${item.active ? "border-line" : "border-dashed border-edge"}`}>
                    <Photo src={item.cover?.thumb_url ?? null} width={item.cover?.width ?? 4} height={item.cover?.height ?? 5} alt="" words={words} eager={i < 2} className={item.active ? "" : "grayscale"} />
                    <span className="flex flex-1 flex-col gap-1 p-3">
                      <span className="line-clamp-2 text-base font-semibold leading-snug [overflow-wrap:anywhere]">{item.name}</span>
                      <span className="text-sm text-muted">{perUnit(words, item.sell_unit)}</span>
                      <span className="text-sm font-semibold">{item.price_text ?? say(words, "mat.products.noprice")}</span>
                      {badgesOf(item).length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {badgesOf(item).map((b) => (
                            <span key={b} data-badge={b} className={`${badge} ${BADGE_TONE[b]}`}>
                              {say(words, b === "inactive" ? "catalogue.badge.inactive" : `catalogue.stock.${b}`)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {more ? (
              <p>
                <Link href={`${base}/materials?after=${encodeURIComponent(more)}${inStockOnly ? "&stock=1" : ""}`} className={secondary}>
                  {say(words, "mat.products.more")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </div>
    </FreshPhotos>
  );
}
