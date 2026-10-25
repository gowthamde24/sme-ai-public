import { meterState, percent, trialDay, trialDaysLeft } from "@/lib/plan/meters";
import type { BillingState, PlanDef, WorkspacePlan } from "@/lib/plan/types";

import { Pill } from "../parts";
import { mutedText, surface } from "../ui";
import { makeT, type Words } from "../words";
import { Meter } from "./Meter";
import { PlanMoves } from "./PlanMoves";
import type { PlanActions } from "./types";

const date = (iso: string): string => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const TONE: Record<BillingState, "neutral" | "green" | "red"> = { none: "neutral", trialing: "green", active: "green", past_due: "red", cancelled: "neutral" };

/**
 * Settings > Plan (job DK): the plan the business is on, the days left of the trial, the two meters (call minutes and WhatsApp messages the business starts: counts and percentages, never money), one gentle notice when a
 * meter passes 80 %, what happens when one is all used (calls and the messages the business starts pause; quotes, orders, follow-ups and customers never stop) and the moves. When the trial ended unpaid the workspace is READ-ONLY
 * (`plan.access`, owner decision of 25 Oct): the card says so first, with the dates the API gives (since when, the day the data is deleted, the days left), and the moves are off. `plan` null = the plan could not be read
 * (the card says "Not available yet"). `mock` shows the test-mode label. The page draws this only when the feature flag is on, and only for an Owner or Admin.
 */
export function PlanSection({ words, plan, def, trialDays, now, canChange, mock, pickerHref, contactEmail, actions }: { words: Words; plan: WorkspacePlan | null; def: PlanDef | null; trialDays: number; now: number; canChange: boolean; mock: boolean; pickerHref: string; contactEmail: string; actions: PlanActions }) {
  const t = makeT(words);
  if (plan === null)
    return (
      <section className={surface} aria-label={t("plan.title")} data-plan-state="unavailable">
        <p className="text-sm text-muted">{t("frame.notyet")}</p>
      </section>
    );
  const today = new Date(now);
  const readOnly = plan.access === "read_only";
  const trial = plan.state === "trialing";
  const left = trialDaysLeft(plan.trialEndsAt, today);
  const readings = [
    { id: "minutes", what: "plan.what.minutes", label: t("plan.meter.minutes"), help: undefined, reading: { used: plan.usage.minutes, included: plan.included.minutes } },
    { id: "messages", what: "plan.what.messages", label: t("plan.meter.messages"), help: t("plan.meter.messages.help"), reading: { used: plan.usage.messages, included: plan.included.messages } },
  ];
  const paused = readings.filter((r) => meterState(r.reading) === "paused");
  const notices = readings.filter((r) => meterState(r.reading) === "notice");
  return (
    <div className="flex flex-col gap-5" data-settings="plan" data-plan-state={plan.state} data-plan-access={plan.access}>
      {mock ? (
        <p role="note" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
          {t("plan.testmode")}
        </p>
      ) : null}
      <section className={surface} aria-labelledby="plan-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="plan-h" className="font-display text-xl font-semibold">
            {def ? t("plan.name.line", { name: def.name }) : t("plan.title")}
          </h2>
          <Pill tone={readOnly ? "red" : TONE[plan.state]}>{t(readOnly ? "plan.state.read_only" : `plan.state.${plan.state}`)}</Pill>
        </div>
        {readOnly ? (
          <div role="alert" data-readonly className="mt-3 rounded-lg border border-red-text bg-red-bg p-3 text-red-text">
            <p className="font-semibold">{t("plan.readonly.title")}</p>
            <p className="text-sm">{t("plan.readonly.body")}</p>
            {plan.readOnlySince ? <p className="text-sm">{t("plan.readonly.since", { date: date(plan.readOnlySince) })}</p> : null}
            {plan.deleteOn ? <p className="text-sm">{t("plan.readonly.until", { date: date(plan.deleteOn), n: plan.dataDaysLeft ?? 0 })}</p> : null}
            <p className="text-sm">{t("plan.readonly.go", { email: contactEmail })}</p>
          </div>
        ) : null}
        {plan.state === "none" ? <p className={mutedText}>{t("plan.none.body", { days: trialDays })}</p> : null}
        {def && def.priceInr === null ? <p className={mutedText}>{t("plan.price.soon")}</p> : null}
        {trial ? (
          <>
            <p className="mt-2 font-medium">{t("plan.trial.day", { n: trialDay(plan.trialEndsAt, today, trialDays), total: trialDays })}</p>
            <p className="text-base">{left === 1 ? t("plan.trial.left.one") : t("plan.trial.left", { n: left })}</p>
            <p className={mutedText}>{t("plan.trial.cancel_note")}</p>
          </>
        ) : null}
        {plan.state === "cancelled" && !readOnly ? <p className="mt-2">{t(plan.cancelledInTrial ? "plan.cancelled.trial" : "plan.cancelled.paid")}</p> : null}
        {plan.state === "active" && plan.periodEndsAt ? <p className={mutedText}>{t(plan.cancelAtPeriodEnd ? "plan.period.cancels" : "plan.period.ends", { date: date(plan.periodEndsAt) })}</p> : null}
        {plan.state === "past_due" ? (
          <div role="alert" className="mt-3 rounded-lg border border-red-text bg-red-bg p-3 text-red-text">
            <p className="font-semibold">{t("plan.pastdue.title")}</p>
            <p className="text-sm">{t("plan.pastdue.body")}</p>
            {plan.graceUntil ? <p className="text-sm">{t("plan.pastdue.until", { date: date(plan.graceUntil) })}</p> : null}
            {plan.cancelAtPeriodEnd && plan.periodEndsAt ? <p className="text-sm">{t("plan.period.cancels", { date: date(plan.periodEndsAt) })}</p> : null}
          </div>
        ) : null}
        <div className="mt-4">
          <PlanMoves words={words} state={plan.state} canChange={canChange && !readOnly} canStart={plan.canStartTrial} cancelling={plan.cancelAtPeriodEnd} pickerHref={pickerHref} trialDays={trialDays} actions={actions} />
        </div>
      </section>
      <section className={surface} aria-labelledby="plan-meters-h">
        <h2 id="plan-meters-h" className="mb-3 text-xl font-semibold">
          {t("plan.meters.title")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {readings.map((r) => (
            <Meter key={r.id} id={r.id} t={t} label={r.label} help={r.help} reading={r.reading} />
          ))}
        </div>
        {notices.length > 0 && paused.length === 0 ? (
          <p role="status" className="mt-3 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
            {t("plan.notice.80", { n: percent(notices[0].reading) ?? 0, what: t(notices[0].what) })}
          </p>
        ) : null}
        {paused.length > 0 ? (
          <div role="alert" className="mt-3 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-amber-text">
            <p className="font-semibold">{t("plan.paused.title")}</p>
            <p className="text-sm">{t("plan.paused.body", { what: t(paused[0].what) })}</p>
          </div>
        ) : null}
      </section>
      <section className={surface} aria-labelledby="plan-100-h">
        <h2 id="plan-100-h" className="text-xl font-semibold">
          {t("plan.at100.title")}
        </h2>
        <p className={mutedText}>{t("plan.at100.body")}</p>
      </section>
    </div>
  );
}
