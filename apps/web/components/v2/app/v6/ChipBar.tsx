import Link from "next/link";

import { chipOff, chipOn } from "./ui";

export type Chip = { id: string; label: string; count?: number; href: string };

/** A row of filter chips with their counts (design system v6: Calls, Leads). Each is a link, so the page keeps its state in the address and works without scripts. The chip in use says so (aria-current) and is also marked by colour. */
export function ChipBar({ label, chips, active }: { label: string; chips: readonly Chip[]; active: string }) {
  return (
    <nav aria-label={label} data-part="chips">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => (
          <li key={c.id} className="shrink-0">
            <Link href={c.href} aria-current={c.id === active ? "page" : undefined} data-chip={c.id} className={c.id === active ? chipOn : chipOff}>
              {c.label}
              {c.count === undefined ? null : <span className="text-muted">{c.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
