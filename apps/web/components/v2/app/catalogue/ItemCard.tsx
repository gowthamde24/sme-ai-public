import Link from "next/link";

import type { ItemSummary } from "@/lib/api/catalogue";

import { say, type TodayWords } from "../today/today-words";
import { badge } from "../visits/styles";
import { badgesOf, priceOf } from "./catalogue-logic";
import { Photo } from "./Photo";

/** The words of a closed list in the person's language, else the API's own English label. */
export const vocab = (words: TodayWords, kind: string, code: string, fallback: string): string => words[`catalogue.${kind}.${code}`] ?? fallback;

const BADGE_TONE = { inactive: "bg-surface-2 text-ink border border-edge", few_left: "bg-amber-bg text-amber-text", made_to_order: "bg-info-bg text-info-text" } as const;

/** A card of the grid: the cover (lazy), the name, the fabric, the price (the exact price if the Owner set one, else the band) and the badges. A hidden item is drawn greyed, for Owner and Admin only. */
export function ItemCard({ item, href, words, eager = false }: { item: ItemSummary; href: string; words: TodayWords; eager?: boolean }) {
  const hidden = !item.active;
  const cover = item.cover;
  return (
    <li className="min-w-0">
      <Link
        href={href}
        data-item={item.id}
        data-hidden={hidden ? "true" : undefined}
        className={`flex h-full min-h-11 flex-col overflow-hidden rounded-2xl border bg-surface hover:border-brand-edge ${hidden ? "border-dashed border-edge" : "border-line"}`}
      >
        <Photo
          src={cover?.thumb_url ?? null}
          width={cover?.width ?? 4}
          height={cover?.height ?? 5}
          alt="" /* the name under it says what it is */
          words={words}
          eager={eager}
          className={hidden ? "grayscale" : ""}
        />
        <span className="flex flex-1 flex-col gap-1 p-3">
          <span className="line-clamp-2 text-base font-semibold leading-snug [overflow-wrap:anywhere]">{item.name}</span>
          <span className="text-sm text-muted">{vocab(words, "fabric", item.fabric, item.fabric_label)}</span>
          <span className="text-sm font-semibold">{priceOf(item)}</span>
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
  );
}
