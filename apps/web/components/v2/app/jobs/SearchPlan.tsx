"use client";

import { Mic, Search, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import type { JobPlan, SearchPatch } from "@/lib/jobs/plan";

import { makeT, type Words } from "../words";
import { SearchChoices } from "./PlanSearch";
import { areaNeeded, searchLimitReached } from "./plan-text";
import { Part, primary, secondary } from "./PlanPart";
import type { PlanCardState } from "./PlanCard";

/**
 * The part of a plan card that only a Lead Finder plan has: its three choices (area, how many, how close a match), what is left of the free searches, and the start (or why there is none): a lazy chunk of its own (LazySearchPlan.tsx), so the New job page,
 * which is at its route-JS ceiling, carries none of it. Same words and same look as the rest of the card.
 */
export function SearchPlan({ plan, words, state, waitingBox, busy, onSearch, onStart, onChange }: { plan: JobPlan; words: Words; state: PlanCardState; waitingBox: ReactNode; busy: boolean; onSearch?: (patch: SearchPatch) => void; onStart: () => void; onChange: () => void }) {
  const t = makeT(words);
  if (!plan.search) return null;
  return (
    <>
      <Part icon={Search} label={t("jobs.new.search.what")} part="plan-search">
        <SearchChoices search={plan.search} t={t} busy={busy} onSearch={onSearch} />
      </Part>
      {plan.cost.searches ? (
        <Part icon={Wallet} label={t("jobs.new.cost")} part="plan-cost">
          {t("jobs.new.search.cost", { left: plan.cost.searches.left, per_month: plan.cost.searches.perMonth })}
        </Part>
      ) : null}
      <div className="mt-1 flex flex-col gap-2.5 border-t border-line pt-3.5">
        {state.error ? (
          <p role="alert" className="m-0 text-sm text-red-text">
            {state.error}
          </p>
        ) : null}
        {waitingBox ??
          (areaNeeded(plan) ? (
            <p role="status" data-part="search-area-needed" className="m-0 rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] leading-snug text-ink">
              {t("jobs.new.search.area_needed")}
            </p>
          ) : searchLimitReached(plan) ? (
            <p role="status" data-part="search-limit" className="m-0 rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] leading-snug text-ink">
              {t("jobs.new.search.limit")}
            </p>
          ) : (
            <button type="button" data-action="start" onClick={onStart} disabled={busy} className={primary}>
              {state.starting ? t("jobs.new.starting") : t("jobs.new.start")}
            </button>
          ))}
        <button type="button" data-action="change" onClick={onChange} disabled={busy} className={secondary}>
          <Mic aria-hidden="true" className="size-[18px]" />
          {t("jobs.new.change")}
        </button>
        <p className="m-0 text-[13px] leading-snug text-muted">
          {t("jobs.new.search.safe")}
          {plan.expiresInMinutes ? ` ${t("jobs.new.expires", { n: plan.expiresInMinutes })}` : ""}
        </p>
      </div>

    </>
  );
}
