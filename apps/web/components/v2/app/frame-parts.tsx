import { Layers, Sparkles } from "lucide-react";

import { formatINR } from "@/design/format";

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

/** The AI usage card (menu footer, the phone's More sheet, Settings): spent / cap today with a meter, from `getAiUsageToday()`; empty while it is still being read, "Not available yet" when it cannot be. */
export function UsageCard({ usage, labels, loading = false, className = "" }: { usage: AiUsage | null; labels?: Labels; loading?: boolean; className?: string }) {
  const title = word(labels, "frame.aiusage", "AI usage today");
  const pct = usage && usage.cap_paise > 0 ? Math.min(100, Math.round((usage.spent_paise / usage.cap_paise) * 100)) : 0;
  return (
    <div className={`rounded-lg border border-line bg-surface p-3 ${className}`}>
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
        <Sparkles className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
        {title}
      </p>
      {usage ? (
        <>
          <p className="mb-2 mt-1 whitespace-nowrap font-display text-xl font-semibold tabular-nums">
            {formatINR(usage.spent_paise / 100)} <span className="text-muted">/ {formatINR(usage.cap_paise / 100)}</span>
          </p>
          <div role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={usage.cap_paise / 100} aria-valuenow={usage.spent_paise / 100} className="h-2 overflow-hidden rounded-full border border-edge bg-surface-2">
            <div className={`h-full bg-brand-edge ${FILL[Math.round(pct / 5) * 5]}`} />
          </div>
          <p className="mt-2 text-sm text-muted">{word(labels, "frame.aileft", "{amount} left today", { amount: formatINR(usage.left_paise / 100) })}</p>
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
