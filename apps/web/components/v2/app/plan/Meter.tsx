import { fillClass } from "../frame-parts";
import { meterState, percent, remaining, type Reading } from "@/lib/plan/meters";

import type { Say } from "../words";

const num = (n: number): string => new Intl.NumberFormat("en-IN").format(n);

/**
 * One meter (job DK): a count and a percentage of what the plan includes, never money. The bar fills in steps of 5; at the gentle notice and at the pause it turns amber. A plan with no cap says what was used and that the
 * business pays for what it uses; a plan that leaves the thing out says so, with no bar.
 */
export function Meter({ id, t, label, help, reading }: { id: string; t: Say; label: string; help?: string; reading: Reading }) {
  const state = meterState(reading);
  const pct = percent(reading);
  const left = remaining(reading);
  return (
    <div className="rounded-lg border border-line bg-surface p-3" data-meter={id} data-state={state}>
      <p className="text-sm font-medium text-muted" id={`${id}-label`}>
        {label}
      </p>
      {help ? <p className="text-sm text-muted">{help}</p> : null}
      {state === "not_included" ? (
        <p className="mt-1 text-base">{t("plan.meter.not_included")}</p>
      ) : state === "no_cap" ? (
        <p className="mt-1 text-base">{t("plan.meter.no_cap", { used: num(reading.used) })}</p>
      ) : (
        <>
          <p className="mb-2 mt-1 font-display text-xl font-semibold tabular-nums">{t("plan.meter.of", { used: num(reading.used), included: num(reading.included ?? 0) })}</p>
          <div role="meter" aria-labelledby={`${id}-label`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} className="h-2 overflow-hidden rounded-full border border-edge bg-surface-2">
            <div className={`h-full ${state === "ok" ? "bg-brand-edge" : "bg-amber-text"} ${fillClass(pct ?? 0)}`} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t("plan.meter.percent", { n: pct ?? 0 })}
            {left !== null ? ` · ${t("plan.meter.left", { n: num(left) })}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
