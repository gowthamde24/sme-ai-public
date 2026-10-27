import { count, dayLabel } from "@/lib/topups/logic";
import type { Meter, UsageView } from "@/lib/topups/types";
import { formatRupeesShort } from "@/lib/money";

import { fillClass } from "../frame-parts";
import { makeT, type Say, type Words } from "../words";
import { SHORT } from "./alert-text";

/**
 * Minutes and messages used and left in this billing period (night 4, part F2): two bars with numbers, what is plan and what is top-up, the day each runs out at this pace, when the unused top-up units expire, and what is
 * waiting. Counts only: never money for the AI, never a token (the AI is included, fair use). A SERVER part, no script. `data-meter` and `role="meter"` as in the old plan meters.
 */
function MeterCard({ t, meter }: { t: Say; meter: Meter }) {
  const short = SHORT[meter.kind];
  const id = `tu-${short}`;
  const stopped = meter.state === "stopped";
  const pct = meter.percent ?? 0;
  const tone = stopped ? "bg-red-text" : meter.state === "notice" ? "bg-amber-text" : "bg-brand-edge";
  const hasCeiling = meter.included && meter.allowance !== null;
  const o = meter.overage;
  return (
    <div className="rounded-lg border border-line bg-surface p-3" data-meter={id} data-state={meter.state}>
      <p className="text-sm font-medium text-muted" id={`${id}-label`}>
        {t(`tu.kind.${short}`)}
      </p>
      {!meter.included ? (
        <p className="mt-1 text-base">{t("tu.bar.notincluded")}</p>
      ) : meter.allowance === null ? (
        <p className="mt-1 text-base">{t("tu.bar.nocap", { used: count(meter.used) })}</p>
      ) : (
        <>
          <p className="mb-2 mt-1 font-display text-xl font-semibold tabular-nums">{t("tu.bar.of", { used: count(meter.used), total: count(meter.allowance) })}</p>
          <div role="meter" aria-labelledby={`${id}-label`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full border border-edge bg-surface-2">
            <div className={`h-full ${tone} ${fillClass(pct)}`} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t("tu.bar.percent", { n: pct })} · {t("tu.bar.left", { n: count(meter.remaining ?? 0) })}
          </p>
        </>
      )}
      {hasCeiling && meter.topupBalance > 0 ? (
        <p className="mt-1 text-sm text-muted">{t("tu.bar.parts", { plan: count(meter.planAllowance ?? 0), topup: count(meter.topupBalance) })}</p>
      ) : null}
      {hasCeiling && stopped ? (
        <p className="mt-1 text-sm font-medium text-red-text">{t(`tu.bar.out.${short}`, { n: meter.queued })}</p>
      ) : hasCeiling && meter.projectedRunOutOn ? (
        <p className="mt-1 text-sm font-medium text-amber-text">{t("tu.bar.pace.run_out", { date: dayLabel(meter.projectedRunOutOn) })}</p>
      ) : hasCeiling && meter.used > 0 ? (
        <p className="mt-1 text-sm text-muted">{t("tu.bar.pace.ok")}</p>
      ) : null}
      {meter.nextTopupExpiry ? <p className="mt-1 text-sm text-muted">{t("tu.bar.expiry", { date: dayLabel(meter.nextTopupExpiry) })}</p> : null}
      {o && (o.enabled || o.units > 0) ? (
        <p className="mt-1 text-sm text-muted">{t("tu.bar.overage", { units: count(o.units), spent: formatRupeesShort(o.spentPaise), cap: formatRupeesShort(o.capPaise) })}</p>
      ) : null}
    </div>
  );
}

export function UsageBars({ words, usage }: { words: Words; usage: UsageView }) {
  const t = makeT(words);
  return (
    <div data-topups="usage">
      <p className="mb-3 text-sm text-muted">{t("tu.period", { start: dayLabel(usage.period.start), end: dayLabel(usage.period.end), n: usage.period.daysLeft })}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MeterCard t={t} meter={usage.minutes} />
        <MeterCard t={t} meter={usage.messages} />
      </div>
    </div>
  );
}
