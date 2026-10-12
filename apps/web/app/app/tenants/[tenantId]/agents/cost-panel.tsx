import { type AgentCostOut } from "@/lib/api/agents";

import { LocalTime } from "../../../local-time";
import { alertBox, bodyText, listPlain, mutedText, pageH2 } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

/** Millionths of the billing currency, as a plain number with up to four decimals (1,500,000 -> "1.5"). */
export function money(micros: number): string {
  return (micros / 1_000_000).toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * Today's (India time, the Asia/Kolkata day) agent spending, for an owner or admin: what is settled, what is still OPEN, and the cap.
 *
 * An OPEN reservation is a model call that was reserved and never settled (its run was cancelled, expired, switched off or
 * crashed mid-call, or the provider's answer was lost). It keeps counting at its WORST case until its Indian day ends, because
 * nobody can tell whether the provider billed it; that is deliberate, so the day is never undercounted.
 */
export function CostPanel({ cost, words }: { cost: AgentCostOut | null; words?: Words; }) {
  const t = makeT(words);
  return (
    <section aria-labelledby="cost-heading">
      <h2 id="cost-heading" className={pageH2}>{t("ag.today_s_agent_spending_india_time")}</h2>
      {cost === null ? (
        <p role="alert" className={alertBox}>
          {t("ag.could_not_load_the_spending_from")}
        </p>
      ) : (
        <>
          <p className={bodyText}>
            <Rich t={t} k="ag.cost_line" vars={{ day: cost.day }} with={{ settled: <strong>{money(cost.settled_micros)}</strong>, open: <strong>{money(cost.open_micros)}</strong>, cap: <strong>{money(cost.cap_micros)}</strong> }} />
          </p>
          <p className={mutedText}>
            {t("ag.open_means_a_model_call_that")}
          </p>
          {cost.open.length === 0 ? (
            <p className={bodyText}>{t("ag.nothing_is_open")}</p>
          ) : (
            <ul className={listPlain}>
              {cost.open.map((o) => (
                <li key={`${o.run_id}-${o.step_key}`}>
                  <p className={bodyText}>
                    <Rich t={t} k="ag.cost_open_line" vars={{ status: t(`ag.run.${o.run_status}`).toLowerCase(), step: o.step_key }} with={{ amount: <strong>{money(o.reserved_micros)}</strong>, time: <LocalTime iso={o.created_at} /> }} />
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
