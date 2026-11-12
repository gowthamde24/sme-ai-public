import Link from "next/link";

import type { NavCounts } from "@/lib/nav-counts";

import { word, type Labels } from "./labels";
import { meterOf, rupeeMeter } from "./nav-badges";

/** A meter's width in steps of 5% (Tailwind cannot build a width from a number at run time). */
const W: Record<number, string> = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i * 5, ["w-0", "w-[5%]", "w-[10%]", "w-[15%]", "w-[20%]", "w-[25%]", "w-[30%]", "w-[35%]", "w-[40%]", "w-[45%]", "w-[50%]", "w-[55%]", "w-[60%]", "w-[65%]", "w-[70%]", "w-[75%]", "w-[80%]", "w-[85%]", "w-[90%]", "w-[95%]", "w-full"][i]]));
const width = (p: number) => W[Math.round(p / 5) * 5] ?? "w-0";

function Meter({ label, value, percent, fill }: { label: string; value: string; percent: number; fill: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={value} className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${fill} ${width(percent)}`} />
      </div>
    </div>
  );
}

/**
 * The foot of the menu (sidebar v2): Call minutes used of the month's and AI usage in rupees of the allowance (C1's nav-counts: the Owner's and an Admin's only; another role, or numbers not known yet, draws no meter), then
 * "Top up · Plan & usage · Help". The meters are what the API says, never a guess; the plan page explains them.
 */
export function NavMeters({ counts, tenantId, labels, manages, onNavigate }: { counts: NavCounts; tenantId: string; labels?: Labels; /** Owner or Admin: Top up and Plan & usage are offered. */ manages: boolean; onNavigate?: () => void }) {
  const minutes = meterOf(counts.callMinutes);
  const ai = rupeeMeter(counts.aiUsage);
  const base = `/app/tenants/${tenantId}`;
  const link = "font-semibold text-brand-text hover:underline";
  const quiet = "text-muted hover:text-ink hover:underline";
  return (
    <div data-nav-meters="" className="space-y-2.5 px-3 py-2">
      {minutes ? <Meter label={word(labels, "nav.meter.minutes", "Call minutes")} value={minutes.text} percent={minutes.percent} fill={minutes.percent >= 90 ? "bg-amber-text" : "bg-brand-edge"} /> : null}
      {ai ? <Meter label={word(labels, "nav.meter.ai", "AI usage")} value={ai.text} percent={ai.percent} fill={ai.percent >= 90 ? "bg-amber-text" : "bg-green-text"} /> : null}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {manages ? (
          <>
            <Link prefetch={false} href={`${base}/settings?section=plan`} onClick={onNavigate} className={link}>
              {word(labels, "nav.link.topup", "Top up")}
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <Link prefetch={false} href={`${base}/settings?section=plan`} onClick={onNavigate} className={quiet}>
              {word(labels, "nav.link.plan", "Plan & usage")}
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
          </>
        ) : null}
        <Link prefetch={false} href={`${base}/help`} onClick={onNavigate} className={quiet}>
          {word(labels, "frame.help", "Help")}
        </Link>
      </p>
    </div>
  );
}
