"use client";

import Link from "next/link";
import { useState } from "react";

export type HelpItem = { slug: string; href: string; title: string; summary: string; text: string; draft?: string };

/** The help center's search and list: the list is drawn on the server (it works without a script); typing narrows it by title, summary and the words of the article. Rows are open (hairlines), one arrow each. */
export function HelpSearch({ items, words }: { items: readonly HelpItem[]; words: { label: string; button: string; none: string } }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle === "" ? items : items.filter((i) => `${i.title} ${i.summary} ${i.text}`.toLowerCase().includes(needle));
  return (
    <div>
      <form role="search" className="my-4 flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <input type="search" aria-label={words.label} placeholder={words.label} value={q} onChange={(e) => setQ(e.target.value)} className="min-h-12 min-w-0 flex-1 rounded-md border border-edge bg-bg px-5 text-base text-ink focus:border-brand-edge" />
        <button type="submit" className="inline-flex min-h-12 shrink-0 items-center rounded-lg border border-edge bg-bg px-5 text-base font-semibold text-ink">{words.button}</button>
      </form>
      {shown.length === 0 ? (
        <p role="status" className="border-t border-ink py-4 text-base text-muted" data-part="help-none">{words.none}</p>
      ) : (
        <ul className="border-t border-ink" data-part="help-list">
          {shown.map((i) => (
            <li key={i.slug} className="border-b border-line">
              <Link href={i.href} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-4 text-ink no-underline">
                <span className="text-lg font-semibold">
                  {i.title}
                  {i.draft ? <span className="ml-2 rounded border border-line px-2 py-0.5 align-middle text-xs font-semibold text-muted">{i.draft}</span> : null}
                </span>
                <span aria-hidden="true" className="row-span-2 text-muted">→</span>
                <span className="text-sm text-muted">{i.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
