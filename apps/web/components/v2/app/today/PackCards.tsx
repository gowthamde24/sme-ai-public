import Link from "next/link";

import type { PackCard } from "@/lib/packs/pack-cards";

import { SIDE_CARD, SIDE_LINE, SIDE_TITLE } from "./side-card";
import type { T } from "./types";

const TONE = { neutral: "", amber: "border-amber-text", red: "border-red-text", green: "border-green-text" } as const;

/**
 * One card a business type adds to Today (jobs CO, CS; a school: fees collected today, reminders running, campus visits, admissions waiting): its title, one figure and one line, the whole card a link to the work. It sits in the
 * summary row with the other cards (sidebar v2). A card whose read failed is never drawn (lib/packs/pack-cards.ts leaves it out: Today never says "Not available yet"). Server drawn: no script.
 */
export function PackCardItem({ card: c, t }: { card: PackCard; t: T }) {
  if (c.value === null) return null;
  return (
    <Link prefetch={false} href={c.href} data-card={c.id} className={`${SIDE_CARD} items-start text-left hover:border-brand-edge ${TONE[c.tone]}`}>
      <h2 className={SIDE_TITLE}>{t(c.titleKey)}</h2>
      <span className="font-display text-3xl font-semibold tabular-nums">{c.value}</span>
      {c.subKey ? <span className={SIDE_LINE}>{t(c.subKey, c.subVars)}</span> : null}
    </Link>
  );
}
