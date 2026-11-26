import { Search } from "lucide-react";
import Link from "next/link";

import type { Availability } from "@/lib/lead-finder/types";

import { JobChip } from "../ds/JobChip";
import { makeT, type Words } from "../words";

const day = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/**
 * Under the title of the Lead Finder (owner, 18 Nov 2026: every plan has the free searches): "1 free search a month on every plan · 1 left this month"; used up: "You've used this month's free search. More searches come with Sales Assistant + Lead Finder." and a link to the plans
 * (no price: nothing is charged here). Nothing is drawn where the API did not say how many (the older answer). The page itself is never hidden.
 */
export function FinderQuota({ words, availability, plansHref, jobs = false, lastSearchAt = null, findHref = null }: { words?: Words; availability: Availability | null; plansHref: string; /** JOBS (mock 05): "1 free search a month · 1 left · last search 12 Nov" with the solid chip and "Find shops now" (a link to the search box, `findHref`). */ jobs?: boolean; lastSearchAt?: string | null; findHref?: string | null }) {
  const per = availability?.searchesPerMonth;
  if (!availability || per === undefined) return null;
  const t = makeT(words);
  const left = availability.reason === "limit_reached" ? 0 : (availability.searchesLeft ?? per);
  if (jobs && left > 0)
    return (
      <div data-part="finder-quota" data-left={left} data-jobs="" className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-[15px] text-muted">
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2">
          <JobChip tone="info">{left === 1 ? t("jobs.trust.left.one") : t("jobs.trust.left.many", { n: left })}</JobChip>
          <span>{[per === 1 ? t("jobs.trust.quota.one", { left }) : t("jobs.trust.quota.many", { per, left }), lastSearchAt ? t("jobs.trust.quota.last", { date: day(lastSearchAt) }) : null].filter(Boolean).join(" · ")}</span>
        </p>
        {findHref ? (
          <a href={findHref} data-act="find-shops" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-brand-edge bg-brand px-6 text-base font-bold text-on-brand">
            <Search aria-hidden="true" className="size-[18px]" />
            {t("jobs.trust.find")}
          </a>
        ) : null}
      </div>
    );
  return (
    <div data-part="finder-quota" data-left={left} className="mt-3 text-sm font-semibold text-muted">
      {left > 0 ? (
        <p className="m-0">{per === 1 ? t("lf.quota.line", { left }) : t("lf.quota.many", { per, left })}</p>
      ) : (
        <p role="note" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink">
          <span>{t("lf.quota.used")}</span>
          <Link href={plansHref} data-act="plans" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
            {t("lf.quota.plans")}
          </Link>
        </p>
      )}
    </div>
  );
}
