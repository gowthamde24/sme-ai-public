import { ImageIcon } from "lucide-react";

import type { SellEntry } from "@/lib/sell/types";

import { JobChip } from "../ds/JobChip";
import type { Say } from "../words";
import { entryText } from "./sell-text";

/** One entry of the list: 56 px at least, the name and its one line at the left, the price and the solid chip at the right (a price list shows its rates under the name). A product has its photo, or a plain square when it has none yet. */
export function SellRowBody({ entry, t }: { entry: SellEntry; t: Say }) {
  const x = entryText(t, entry);
  return (
    <>
      {entry.style === "products" ? (
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-muted">
          {entry.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed link of the catalogue's storage that runs out: never optimised or cached by us
            <img src={entry.photo} alt="" width={48} height={48} loading="lazy" decoding="async" className="size-12 object-cover" />
          ) : (
            <ImageIcon className="size-5" />
          )}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[16px] font-semibold leading-snug text-ink">{x.title}</span>
        <span className="block truncate text-[13px] leading-snug text-muted">{x.line}</span>
        {x.rates.length > 0 ? (
          <span data-part="rates" className="mt-1.5 flex flex-wrap gap-1.5">
            {x.rates.map((r) => (
              <span key={r} className="rounded bg-surface-2 px-2.5 py-0.5 text-[13px] font-semibold text-ink">
                {r}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {x.price || x.chip ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {x.price ? <span className="text-[16px] font-bold leading-tight text-ink">{x.price}</span> : null}
          {x.chip ? x.chip.solid ? <JobChip tone={x.chip.tone}>{x.chip.text}</JobChip> : <span data-part="chip" className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-[var(--jb-info-soft)] px-3 text-[13px] font-semibold text-ink">{x.chip.text}</span> : null}
        </span>
      ) : null}
    </>
  );
}
