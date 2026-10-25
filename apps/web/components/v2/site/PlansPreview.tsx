"use client";

import Link from "next/link";
import { useState } from "react";

export type PlanCardData = { id: string; name: string; features: readonly string[]; cta: string; href: string };
export type PlanTab = { key: string; label: string; plans: readonly PlanCardData[] };

/**
 * The plans of the home page (job DM): two tabs (the full AI workforce, AI calling only) and a card for each plan. A plan's name and numbers come from the plans data (the server turns them into words); no price is shown, only
 * "Price at launch", because none is set. The first card of a tab is not "most popular": no plan is, and a claim like that would need a number we do not have. The tablist is real (arrow keys, Home and End).
 */
export function PlansPreview({ tabs, label, price }: { tabs: readonly PlanTab[]; label: string; price: string }) {
  const [key, setKey] = useState(tabs[0].key);
  const current = tabs.find((t) => t.key === key) ?? tabs[0];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setKey(tabs[to].key);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label={label} className="inline-flex self-start rounded-2xl border border-line bg-surface p-1">
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" id={`plans-tab-${t.key}`} aria-selected={t.key === key} aria-controls="plans-panel" tabIndex={t.key === key ? 0 : -1} onClick={() => setKey(t.key)} onKeyDown={(e) => onKey(e, i)} className={`min-h-11 rounded-xl px-5 text-sm font-semibold ${t.key === key ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="plans-panel" aria-labelledby={`plans-tab-${current.key}`} className="grid gap-5 lg:grid-cols-3" data-part="plans">
        {current.plans.map((p) => (
          <article key={p.id} data-plan-card="" className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-7">
            <h3 className="font-display text-2xl font-bold">{p.name}</h3>
            <strong className="font-display text-2xl font-extrabold">{price}</strong>
            <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed text-muted">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <span aria-hidden="true" className="font-bold text-brand-text">
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <span className="flex-1" />
            <Link href={p.href} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-edge bg-surface px-4 text-[15px] font-semibold text-ink hover:bg-surface-2">
              {p.cta}
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
