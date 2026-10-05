import { RUN_STATUS_LABELS, type AgentCostOut } from "@/lib/api/agents";

import { LocalTime } from "../../../local-time";

/** Millionths of the billing currency, as a plain number with up to four decimals (1,500,000 -> "1.5"). */
export function money(micros: number): string {
  return (micros / 1_000_000).toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * Today's (UTC) agent spending, for an owner or admin: what is settled, what is still OPEN, and the cap.
 *
 * An OPEN reservation is a model call that was reserved and never settled (its run was cancelled, expired, switched off or
 * crashed mid-call, or the provider's answer was lost). It keeps counting at its WORST case until its UTC day ends, because
 * nobody can tell whether the provider billed it; that is deliberate, so the day is never undercounted.
 */
export function CostPanel({ cost }: { cost: AgentCostOut | null }) {
  return (
    <section aria-labelledby="cost-heading">
      <h2 id="cost-heading">Today&apos;s agent spending (UTC)</h2>
      {cost === null ? (
        <p role="alert" className="error">
          Could not load the spending from the API. Try again shortly.
        </p>
      ) : (
        <>
          <p>
            Settled <strong>{money(cost.settled_micros)}</strong> + open <strong>{money(cost.open_micros)}</strong> of a daily
            cap of <strong>{money(cost.cap_micros)}</strong> ({cost.day}). Amounts are in the billing currency.
          </p>
          <p className="hint">
            Open means a model call that was reserved and never settled (its run was cancelled, expired, switched off or
            interrupted, or the provider&apos;s answer was lost). It is counted at its worst case until midnight UTC, because nobody
            can tell whether it was billed.
          </p>
          {cost.open.length === 0 ? (
            <p>Nothing is open.</p>
          ) : (
            <ul className="evidence-list">
              {cost.open.map((o) => (
                <li key={`${o.run_id}-${o.step_key}`}>
                  <p>
                    Open <strong>{money(o.reserved_micros)}</strong> · run {RUN_STATUS_LABELS[o.run_status].toLowerCase()} ·{" "}
                    {o.step_key} · <LocalTime iso={o.created_at} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
