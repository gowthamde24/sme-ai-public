import { Camera } from "lucide-react";
import Link from "next/link";

import type { ItemSummary } from "@/lib/api/catalogue";

import { say, type TodayWords } from "../today/today-words";
import { badge } from "../visits/styles";
import { badgesOf, priceOf } from "./catalogue-logic";
import { Photo } from "./Photo";

/** The words of a closed list in the person's language, else the API's own English label. */
export const vocab = (words: TodayWords, kind: string, code: string, fallback: string): string => words[`catalogue.${kind}.${code}`] ?? fallback;

const BADGE_TONE = { inactive: "bg-surface-2 text-ink border border-edge", few_left: "bg-amber-bg text-amber-text", made_to_order: "bg-info-bg text-info-text", out_of_stock: "border border-ink font-bold text-ink" } as const;

/**
 * A card of the grid: the cover (lazy), the name, the fabric, the price (the exact price if the Owner set one, else the band) and the badges. A hidden item is drawn greyed, for Owner and Admin only.
 * Design system v6 (`edit` is given): a hidden item keeps its photo in colour and says "Draft" in a pill (the greyed photo looked like an empty box); an item with NO photo gets a small "Add photo" prompt that opens its
 * Edit page instead of a blank 4:5 block; and the Edit link sits under the card (the card no longer stretches over it).
 */
export function ItemCard({ item, href, words, eager = false, edit = null }: { item: ItemSummary; href: string; words: TodayWords; eager?: boolean; /** Design system v6: an Edit link under the card (Owner and Admin). */ edit?: string | null }) {
  const hidden = !item.active;
  const cover = item.cover;
  const v6 = edit !== null;
  const addPhoto = v6 && cover === null;
  return (
    <li className="relative flex min-w-0 flex-col">
      <Link
        href={href}
        data-item={item.id}
        data-hidden={hidden ? "true" : undefined}
        className={`flex min-h-11 flex-1 flex-col overflow-hidden rounded-xl border bg-surface hover:border-brand-edge ${hidden ? "border-dashed border-edge" : "border-line"}`}
      >
        {addPhoto ? (
          <span aria-hidden="true" className="block h-20 border-b border-dashed border-edge bg-surface-2" />
        ) : (
          <Photo
            src={cover?.thumb_url ?? null}
            width={cover?.width ?? 4}
            height={cover?.height ?? 5}
            alt="" /* the name under it says what it is */
            words={words}
            eager={eager}
            className={hidden && !v6 ? "grayscale" : ""}
          />
        )}
        <span className="flex flex-1 flex-col gap-1 p-3">
          <span className="line-clamp-2 text-base font-semibold leading-snug [overflow-wrap:anywhere]">{item.name}</span>
          <span className="text-sm text-muted">{vocab(words, "fabric", item.fabric, item.fabric_label)}</span>
          <span className="text-sm font-semibold">{priceOf(item)}</span>
          {badgesOf(item).length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {badgesOf(item).map((b) => (
                <span key={b} data-badge={b} className={`${badge} ${BADGE_TONE[b]}`}>
                  {say(words, b === "inactive" ? (v6 ? "catalogue.v6.draft" : "catalogue.badge.inactive") : `catalogue.stock.${b}`)}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </Link>
      {addPhoto && edit ? (
        <Link href={edit} data-part="add-photo" className="absolute inset-x-0 top-0 flex h-20 items-center justify-center gap-2 rounded-t-xl text-base font-semibold text-brand-text hover:underline">
          <Camera className="size-5" aria-hidden="true" />
          {say(words, "catalogue.v6.addphoto")}
        </Link>
      ) : null}
      {edit ? (
        <Link href={edit} data-part="item-edit" className="mt-1 inline-flex min-h-11 items-center px-1 text-base font-semibold text-brand-text hover:underline">
          {say(words, "catalogue.v6.edit")}
        </Link>
      ) : null}
    </li>
  );
}
