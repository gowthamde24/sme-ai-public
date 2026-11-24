import Link from "next/link";

import { MAX_LISTS, type SellList } from "@/lib/lists/types";

import { btnMainLink } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Your lists" on What you sell (flag WHAT_YOU_SELL_LISTS; mock "What you sell"): one boxed card for each list the owner made (a thing you choose: one border, light radius, no shadow): its kind, its name, how many items, and Add a list. Opening a card opens the list.
 */
export function ListCards({ lists, words, base, canAdd }: { lists: readonly SellList[]; words: Words; base: string; canAdd: boolean }) {
  const t = makeT(words);
  return (
    <section data-part="lists" aria-labelledby="wls-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wls-h" className="m-0 font-display text-xl font-semibold md:text-2xl">
          {t("wls.title")}
        </h2>
        {canAdd ? (
          <Link href={`${base}/lists/new`} className={btnMainLink}>
            {t("wls.add")}
          </Link>
        ) : null}
      </div>
      <p className="m-0 text-[15px] text-muted">{t("wls.sub")}</p>
      {lists.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <li key={l.id}>
              <Link href={`${base}/lists/${l.id}`} data-list={l.id} className="flex min-h-[116px] flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-[18px] no-underline hover:border-ink focus-visible:border-ink">
                <span className="text-[14px] font-semibold text-muted">{t(`wls.kind.${l.kind}` as "wls.kind.products")}</span>
                <b className="text-[18px] font-bold text-ink">{l.name}</b>
                <span className="mt-auto text-[15px] font-semibold text-ink">{t("wls.items", { n: l.rowCount })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-[14px] text-muted">{t("wls.used", { n: lists.length, max: MAX_LISTS })}</p>
    </section>
  );
}
