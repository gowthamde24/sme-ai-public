import Link from "next/link";

import type { PackCard } from "@/lib/packs/pack-cards";

import type { T } from "./types";

const TONE = { neutral: "border-line", amber: "border-amber-text bg-amber-bg", red: "border-red-text bg-red-bg", green: "border-green-text bg-green-bg" } as const;

/** The cards a business type adds to Today (jobs CO, CS): a title, one figure, one line under it and a link to the work. A card whose read failed says "Not available yet". Server drawn: no script. */
export function PackCards({ cards, t }: { cards: readonly PackCard[]; t: T }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label={t("today.pack.label")} data-part="pack-cards" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-1">
      {cards.map((c) => (
        <Link key={c.id} href={c.href} data-card={c.id} className={`flex min-h-11 flex-col gap-1 rounded-[20px] border p-4 hover:border-brand-edge ${c.value === null ? "border-line bg-surface" : `${TONE[c.tone]} bg-surface`}`}>
          <span className="text-sm font-semibold text-muted">{t(c.titleKey)}</span>
          {c.value === null ? (
            <span className="text-base font-semibold">{t("frame.notyet")}</span>
          ) : (
            <>
              <span className="font-display text-3xl font-bold tabular-nums">{c.value}</span>
              {c.subKey ? <span className="text-sm">{t(c.subKey, c.subVars)}</span> : null}
            </>
          )}
        </Link>
      ))}
    </section>
  );
}
