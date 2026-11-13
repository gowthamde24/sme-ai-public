import { Search } from "lucide-react";

import type { CallsQuery } from "@/lib/calls/filter";

import { makeT, type Words } from "../../words";

/**
 * The search box at the right of the Calls heading (approved mock): one rounded box, an icon, "Search name, number or what they said". Enter searches (a plain GET form, so it works without a script) and the status, date and number the person chose are kept. It looks in
 * names, numbers, the summary and the outcome sentence; the exact words said on a call are not searched yet, which is said to screen readers (and in the guide).
 */
export function CallsSearch({ words, base, query }: { words: Words; base: string; query: CallsQuery }) {
  const t = makeT(words);
  return (
    <form action={`${base}/calls`} method="get" role="search" className="w-full md:w-[380px]">
      {query.status !== "all" ? <input type="hidden" name="status" value={query.status} /> : null}
      {query.when !== "any" ? <input type="hidden" name="when" value={query.when} /> : null}
      {query.line ? <input type="hidden" name="line" value={query.line} /> : null}
      <label className="relative block">
        <span className="sr-only">
          {t("calls6.search.label")}. {t("calls6.search.note")}
        </span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input type="search" name="q" defaultValue={query.q} maxLength={80} placeholder={t("calls6.search.placeholder")} className="min-h-11 w-full rounded-[14px] border border-line bg-surface pl-10 pr-3 text-[14px] text-ink placeholder:text-muted focus:border-brand-edge" />
      </label>
      <button type="submit" className="sr-only">
        {t("calls6.search.go")}
      </button>
    </form>
  );
}
