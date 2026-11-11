import { Sparkles } from "lucide-react";
import Link from "next/link";

import { makeT, type Words } from "../words";

/**
 * "Finding new customers is part of AI Workforce" (owner decision 4 Nov: plan tiers): what a Lead Desk workspace sees where the Lead Finder would be (the Prospects tab, the chat's search card), one sentence of what it does and the way to Settings ->
 * Plan or the plans page (lib/plan/tier-source.ts `upgradeHref`). NO payment here: the link only shows what each plan includes. `planHref` null = the person cannot change the plan (Sales, a Viewer): the card says who can instead. No hooks, so the server pages and the chat panel (a client
 * component) draw the same card. Words: `tier.upsell.*` (a school's own sentence is `tier.upsell.finder@programmes`, chosen by the page).
 */
export function PlanUpsell({ words, planHref, compact = false }: { words: Words; planHref: string | null; /** The chat: smaller, no shadow. */ compact?: boolean }) {
  const t = makeT(words);
  return (
    <section data-upsell="lead_finder" aria-labelledby="upsell-title" className={compact ? "flex flex-col gap-2" : "flex max-w-2xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5"}>
      <h2 id="upsell-title" className={`flex items-center gap-2 font-display font-semibold ${compact ? "text-base" : "text-xl"}`}>
        <Sparkles className="size-5 shrink-0 text-brand-text" aria-hidden="true" />
        {t("tier.upsell.title")}
      </h2>
      <p className="text-base [overflow-wrap:anywhere]">{t("tier.upsell.finder")}</p>
      <p className="text-sm text-muted">{t("tier.upsell.now")}</p>
      {planHref ? (
        <p>
          <Link href={planHref} data-upsell-link="" className="inline-flex min-h-11 items-center rounded-full border border-brand-edge bg-brand-bg px-4 text-[15px] font-semibold text-brand-text hover:brightness-95">
            {t("tier.upsell.see")}
          </Link>
        </p>
      ) : (
        <p data-upsell-who="" className="text-sm font-medium text-muted">
          {t("tier.upsell.who")}
        </p>
      )}
    </section>
  );
}
