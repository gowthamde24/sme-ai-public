"use client";

import Link from "next/link";

/** The "More" of a tab row: the pages that are not used every day, in a small disclosure. A chunk of its own (next/dynamic in GroupTabs): only the rows that have a More load it. */
export default function TabsMoreMenu({ label, items }: { label: string; items: readonly { key: string; label: string; href: string }[] }) {
  return (
    <details className="relative" data-part="tabs-more">
      <summary className="mb-px inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-3 text-base font-medium text-muted hover:text-ink">{label} ▾</summary>
      <ul className="absolute right-0 z-20 mt-1 flex min-w-48 list-none flex-col gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lg">
        {items.map((t) => (
          <li key={t.key}>
            <Link href={t.href} className="flex min-h-11 items-center rounded-lg px-3 text-base text-ink hover:bg-surface-2">{t.label}</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
