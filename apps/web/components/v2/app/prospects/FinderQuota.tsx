import Link from "next/link";

import type { Availability } from "@/lib/lead-finder/types";

import { makeT, type Words } from "../words";

/**
 * Under the title of the Lead Finder (owner, 18 Nov 2026: every plan has the free searches): "1 free search a month on every plan · 1 left this month"; used up: "You've used this month's free search. More searches come with Sales Assistant + Lead Finder." and a link to the plans
 * (no price: nothing is charged here). Nothing is drawn where the API did not say how many (the older answer). The page itself is never hidden.
 */
export function FinderQuota({ words, availability, plansHref }: { words?: Words; availability: Availability | null; plansHref: string }) {
  const per = availability?.searchesPerMonth;
  if (!availability || per === undefined) return null;
  const t = makeT(words);
  const left = availability.reason === "limit_reached" ? 0 : (availability.searchesLeft ?? per);
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
