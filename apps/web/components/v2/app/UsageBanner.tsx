"use client";

import Link from "next/link";

import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { indiaTime, untilFor } from "./frame-parts";
import { word, type Labels } from "./labels";
import { useWorkspace, type Membership } from "./use-workspace";

/** From this share of today's or this month's AI allowance a small banner says so; below it the usage is not on the main screens at all (it lives in Settings, Plan and usage). */
export const USAGE_BANNER_FROM = 90;

/**
 * The one place usage still shows outside Settings (owner 31 Oct): a small banner when the assistant has used 90 % or more of today's or this month's allowance (and when it is in its lighter mode or paused), with the way to Settings, Plan and usage.
 * Only for the people the API gives the usage to (Owner, Admin); nothing is drawn while it is being read or when it cannot be.
 */
export function UsageBanner({ memberships, labels, frame: given }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData }) {
  const { current } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const usage = frame.usage;
  if (!current || !frame.showUsage || !usage) return null;
  const percent = Math.max(usage.today_percent, usage.month_percent);
  if (percent < USAGE_BANNER_FROM && usage.state === "ok") return null;
  const until = untilFor(usage);
  const text =
    usage.state === "paused"
      ? until
        ? word(labels, "frame.aipaused", "Your AI team is paused until {time}. Quotes, orders and customers keep working.", { time: indiaTime(until) })
        : word(labels, "frame.aipausednow", "Your AI team is paused. Quotes, orders and customers keep working.")
      : usage.state === "light"
        ? word(labels, "frame.ailight", "Light mode until {time}", { time: indiaTime(until ?? usage.resets_at_today) })
        : usage.today_percent >= usage.month_percent
          ? word(labels, "frame.usagebanner.today", "Your assistant has used {percent}% of today's allowance. At 100% it switches to a lighter mode.", { percent: usage.today_percent })
          : word(labels, "frame.usagebanner.month", "Your assistant has used {percent}% of this month's allowance. At 100% it switches to a lighter mode.", { percent: usage.month_percent });
  return (
    <div data-frame="usage-banner" role="status" className="mx-auto w-full max-w-[1200px] px-4 pt-3 md:px-8 print:hidden">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
        <span className="min-w-0 flex-1">{text}</span>
        <Link href={`/app/tenants/${current.id}/settings?section=plan`} className="shrink-0 font-semibold underline underline-offset-2">
          {word(labels, "frame.usagebanner.see", "See usage")}
        </Link>
      </p>
    </div>
  );
}
