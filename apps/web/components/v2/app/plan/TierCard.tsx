import { Check, Minus } from "lucide-react";
import Link from "next/link";

import { INCLUDED, TIER_NAMES, tierName, type Entitlements, type Included } from "@/lib/plan/tier";

import { inlineLink, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Settings -> Plan, on top (owner decision 4 Nov: plan tiers): the plan badge ("AI Workforce" / "Lead Desk") and a short "What's included" list. On Lead Desk the Lead Finder's line says it is part of AI Workforce, and the Owner is
 * shown how to move (the plans page when the plan screens are on, else a line to write to us): NO payment flow here, nothing is charged. `items`: the features this business has at all (a business without quotes is not told it
 * gets quotes); the page decides. `move`: `plans` = a link to the plans page, `write` = the billing address, null = the person cannot change the plan (an Admin: the Owner can).
 */
export function TierCard({ words, plan, items, move }: { words: Words; plan: Entitlements; items: readonly Included[]; move: { kind: "plans"; href: string } | { kind: "write"; email: string } | null }) {
  const t = makeT(words);
  const shown = INCLUDED.filter((i) => items.includes(i));
  return (
    <section className={surface} aria-labelledby="tier-heading" data-part="tier" data-tier={plan.tier}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tier-heading" className="font-display text-xl font-semibold">
          {t("tier.title")}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-edge bg-brand-bg px-3 py-1 text-sm font-bold text-brand-text" data-tier-badge="">
          <span className="sr-only">{t("tier.badge")}: </span>
          {tierName(plan)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{t(`tier.sub.${plan.tier}`)}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((i) => {
          const on = i !== "finder" || plan.features.leadFinder;
          return (
            <li key={i} data-included={i} data-on={on ? "" : undefined} className={`flex items-start gap-2 text-base ${on ? "" : "text-muted"}`}>
              {on ? <Check className="mt-0.5 size-5 shrink-0 text-green-text" aria-hidden="true" /> : <Minus className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
              <span>
                {on ? t(`tier.inc.${i}`) : t("tier.inc.finder.off")}
                {on ? null : <span className="sr-only"> ({t("tier.inc.no")})</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {plan.upgradeTo ? (
        <div className="mt-4 border-t border-line pt-3 text-sm" data-part="tier-move">
          {move === null ? (
            <p className="text-muted">{t("tier.move.owner")}</p>
          ) : move.kind === "plans" ? (
            <Link href={move.href} className={inlineLink}>
              {t("tier.move.plans")}
            </Link>
          ) : (
            <p>
              {t("tier.move.write")}{" "}
              <a href={`mailto:${move.email}?subject=${encodeURIComponent(TIER_NAMES.ai_workforce)}`} className={`${inlineLink} [overflow-wrap:anywhere]`}>
                {move.email}
              </a>
            </p>
          )}
          <p className="mt-1 text-muted">{t("tier.move.free")}</p>
        </div>
      ) : null}
    </section>
  );
}
