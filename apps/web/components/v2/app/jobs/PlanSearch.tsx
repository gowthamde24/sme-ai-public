"use client";

import { useState } from "react";

import { SEARCH_AREA_MAX, SEARCH_FIT_BARS, SEARCH_RESULTS, type PlanSearch as Search, type SearchPatch } from "@/lib/jobs/plan";

import type { Say } from "../words";
import { Choose, Sentence, Val } from "./rules/parts";

/**
 * THE THREE CHOICES of a Lead Finder (researcher) plan card (contract 1.1 part 1, section 8 item 4): where to look (the owner's own words; the shop's town is the default the API sends), how many businesses (5, 10 or 20) and how good a fit they must be (60, 70, 80 or 90 out of 100).
 * Each is a plain sentence with the choice inside (the same parts as the rules). A change calls `onSearch` with ONLY what changed; the card then draws the plan that comes back. Without `onSearch` the choices are read, not changed.
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
  const area = (aria: string) =>
    onSearch ? (
      <input
        type="text"
        aria-label={aria}
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
        className="write-ctl mx-0.5 my-0.5 min-h-10 w-44 max-w-full rounded-full border border-transparent bg-brand-bg px-3.5 align-middle text-[16px] font-semibold text-brand-text disabled:opacity-80"
      />
    ) : (
      <Val>{search.area}</Val>
    );
  const results = (aria: string) =>
    onSearch ? <Choose aria={aria} value={String(search.results)} options={SEARCH_RESULTS.map(String)} text={(v) => v} disabled={busy} onChange={(v) => onSearch({ results: Number(v) as (typeof SEARCH_RESULTS)[number] })} /> : <Val>{search.results}</Val>;
  const fit = (aria: string) =>
    onSearch ? <Choose aria={aria} value={String(search.fitBar)} options={SEARCH_FIT_BARS.map(String)} text={(v) => v} disabled={busy} onChange={(v) => onSearch({ fitBar: Number(v) as (typeof SEARCH_FIT_BARS)[number] })} /> : <Val>{search.fitBar}</Val>;
  return (
    <div data-part="search-choices" className="flex flex-col">
      <Sentence line="search_area" template={t("jobs.new.search.area")} parts={{ area }} />
      <Sentence line="search_results" template={t("jobs.new.search.results")} parts={{ results }} />
      <Sentence line="search_fit" template={t("jobs.new.search.fit")} parts={{ fit }} />
    </div>
  );
}
