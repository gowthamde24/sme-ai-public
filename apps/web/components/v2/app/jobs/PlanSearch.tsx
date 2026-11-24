"use client";

import { useState } from "react";

import type { PlanSearch as Search, SearchPatch } from "@/lib/jobs/plan";
import { SEARCH_AREA_MAX, SEARCH_FIT_BARS, SEARCH_RESULTS } from "@/lib/jobs/plan-const";

import type { Say } from "../words";

/**
 * THE THREE CHOICES of a Lead Finder (researcher) plan card (contract 1.1 part 1, section 8 item 4): where to look (the owner's own words; the shop's town is the default the API sends), how many businesses (5, 10 or 20) and how good a fit they must be (60, 70, 80 or 90 out of 100).
 * Each is a labelled field (owner, 29 Nov 2026: no sentence with a blank). A change calls `onSearch` with ONLY what changed; the card then draws the plan that comes back. Without `onSearch` the choices are read, not changed.
 */
export function SearchChoices({ search, t, busy, onSearch }: { search: Search; t: Say; busy: boolean; onSearch?: (patch: SearchPatch) => void }) {
  // the area is typed: it goes with Enter or when the box is left, and an empty box puts the plan's own area back
  const [draft, setDraft] = useState<{ of: string; text: string }>({ of: search.area, text: search.area });
  const text = draft.of === search.area ? draft.text : search.area;
  const commit = () => {
    const area = text.trim();
    if (area === "" || area === search.area) {
      setDraft({ of: search.area, text: search.area });
      return;
    }
    onSearch?.({ area: area.slice(0, SEARCH_AREA_MAX) });
  };
  const label = "text-[15px] font-bold text-ink";
  const field = "min-h-11 w-full rounded-lg border border-edge bg-transparent px-3 text-[16px] text-ink outline-none focus:border-brand-edge disabled:opacity-60";
  // (owner, 29 Nov 2026: no sentence with a blank: a label above each of the three choices)
  return (
    <div data-part="search-choices" className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("jobs.new.search.f.area")}</span>
        {onSearch ? (
          <input
            type="text"
            data-search="area"
            value={text}
            maxLength={SEARCH_AREA_MAX}
            disabled={busy}
            onChange={(e) => setDraft({ of: search.area, text: e.target.value })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
              }
            }}
            className={field}
          />
        ) : (
          <span className="text-[16px] text-ink">{search.area}</span>
        )}
        <span className="text-[14px] text-muted">{t("jobs.new.search.h.area")}</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("jobs.new.search.f.results")}</span>
        {onSearch ? (
          <select value={String(search.results)} disabled={busy} onChange={(e) => onSearch({ results: Number(e.target.value) as (typeof SEARCH_RESULTS)[number] })} className={field}>
            {SEARCH_RESULTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[16px] text-ink">{search.results}</span>
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={label}>{t("jobs.new.search.f.fit")}</span>
        {onSearch ? (
          <select value={String(search.fitBar)} disabled={busy} onChange={(e) => onSearch({ fitBar: Number(e.target.value) as (typeof SEARCH_FIT_BARS)[number] })} className={field}>
            {SEARCH_FIT_BARS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[16px] text-ink">{search.fitBar}</span>
        )}
        <span className="text-[14px] text-muted">{t("jobs.new.search.h.fit")}</span>
      </label>
    </div>
  );
}
