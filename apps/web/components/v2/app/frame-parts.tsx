import { Layers, Sparkles } from "lucide-react";

import type { AiUsage, Plan } from "./contract";
import { word, type Labels } from "./labels";

/** The width of the meter's fill in steps of 5% (a class per step: no inline style, and Tailwind sees every class). */
const FILL: Record<number, string> = { 0: "w-[0%]", 5: "w-[5%]", 10: "w-[10%]", 15: "w-[15%]", 20: "w-[20%]", 25: "w-[25%]", 30: "w-[30%]", 35: "w-[35%]", 40: "w-[40%]", 45: "w-[45%]", 50: "w-[50%]", 55: "w-[55%]", 60: "w-[60%]", 65: "w-[65%]", 70: "w-[70%]", 75: "w-[75%]", 80: "w-[80%]", 85: "w-[85%]", 90: "w-[90%]", 95: "w-[95%]", 100: "w-[100%]" };

/** The orange mark that stands for the business (the design-lab app's BrandMark). */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-lg border border-brand-edge bg-brand text-on-brand ${className}`}>
      <Layers className="size-5" />
    </span>
  );
}

/** "free_trial" -> "Free trial plan": the plan's name from `getPlan()` (`frame.plan.<name>`, else the name with its underscores opened), inside the frame's own sentence. */
export function planText(plan: Plan | null, labels?: Labels): string | null {
  if (!plan) return null;
  const spoken = plan.plan.replace(/_/g, " ");
  const name = word(labels, `frame.plan.${plan.plan}`, spoken.charAt(0).toUpperCase() + spoken.slice(1));
  return word(labels, "frame.plan", "{plan} plan", { plan: name });
}

/** "Not available yet": what an element says while the data behind it cannot be read. Never a guess. */
export function NotYetText({ labels, className = "text-sm text-muted" }: { labels?: Labels; className?: string }) {
  return <span className={className}>{word(labels, "frame.notyet", "Not available yet")}</span>;
}

/** "11 Oct, 12:00 am": a moment in the Indian day, which is the day the allowance counts in. Fixed zone and locale, so the server and the browser draw the same text. */
export function indiaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/**
 * When the lighter mode (or the pause) ends, from the two windows. Light lasts while EITHER window is at 100 %, so it ends at the later reset: the month's when the month is full, else the day's.
 * A pause is 300 % of ONE window: if only one window is full it is that one; if both are full the API does not say which, so no time is guessed (null).
 */
export function untilFor(usage: AiUsage): string | null {
  const dayFull = usage.today_percent >= 100;
  const monthFull = usage.month_percent >= 100;
  if (usage.state === "light") return monthFull ? usage.resets_at_month : usage.resets_at_today;
  if (usage.state === "paused") return monthFull && dayFull ? null : monthFull ? usage.resets_at_month : usage.resets_at_today;
  return null;
}

/**
 * The AI usage card (menu footer, the phone's More sheet, Settings), from `getAiUsage()` (`GET /ai-usage`): how much of today's and this month's allowance is used, in percent, with a meter
 * (no money, no tokens). `state` carries what the percentages cannot (they stop at 100): busy (warn), light mode and paused. Empty while it is being read, "Not available yet" when it cannot be.
 */
export function UsageCard({ usage, labels, loading = false, className = "" }: { usage: AiUsage | null; labels?: Labels; loading?: boolean; className?: string }) {
  const title = word(labels, "frame.aiusage", "AI usage today");
  const pct = usage ? usage.today_percent : 0;
  const until = usage ? untilFor(usage) : null;
  const timeVars = until ? { time: indiaTime(until) } : undefined;
  return (
    <div className={`rounded-lg border border-line bg-surface p-3 ${className}`}>
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        <Sparkles className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
        {title}
      </p>
      {usage ? (
        <>
          <p className="mb-2 mt-1 whitespace-nowrap font-display text-xl font-semibold tabular-nums">{word(labels, "frame.aiused", "{percent}% used", { percent: usage.today_percent })}</p>
          <div role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.today_percent} className="h-2 overflow-hidden rounded-full border border-edge bg-surface-2">
            <div className={`h-full ${usage.state === "ok" ? "bg-brand-edge" : "bg-amber-text"} ${FILL[Math.round(pct / 5) * 5]}`} />
          </div>
          <p className="mt-2 text-sm text-muted">{word(labels, "frame.aimonth", "{percent}% of this month", { percent: usage.month_percent })}</p>
          {usage.state === "warn" ? <p className="mt-2 text-sm">{word(labels, "frame.aiwarn", "Your AI team has been busy today. It keeps working; at the limit it switches to a lighter mode until midnight.")}</p> : null}
          {usage.state === "light" ? (
            <p className="mt-2 inline-block rounded-full border border-amber-text bg-amber-bg px-2.5 py-1 text-sm font-medium text-amber-text">
              {word(labels, "frame.ailight", "Light mode until {time}", { time: indiaTime(until ?? usage.resets_at_today) })}
            </p>
          ) : null}
          {usage.state === "paused" ? (
            <p className="mt-2 rounded-lg border border-amber-text bg-amber-bg px-2.5 py-1.5 text-sm font-medium text-amber-text">
              {timeVars ? word(labels, "frame.aipaused", "Your AI team is paused until {time}. Quotes, orders and customers keep working.", timeVars) : word(labels, "frame.aipausednow", "Your AI team is paused for now. Quotes, orders and customers keep working.")}
            </p>
          ) : null}
        </>
      ) : loading ? (
        <p aria-hidden="true" className="mt-1 min-h-6" />
      ) : (
        <p className="mt-1">
          <NotYetText labels={labels} />
        </p>
      )}
    </div>
  );
}
