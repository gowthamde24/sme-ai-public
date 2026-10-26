"use client";

import Link from "next/link";
import * as React from "react";

import type { BillingState } from "@/lib/plan/types";

import { btnMain, btnQuiet, fieldHelp } from "../ui";
import { makeT, type Words } from "../words";
import type { PlanActions } from "./types";
import { usePlanMove } from "./use-plan-move";

/**
 * What the owner can DO on the Plan part (job DK): put a payment that failed right (where the provider has that move), go to the plans, cancel (asks once, and says nothing is charged when it is inside the trial; a paid plan runs to the end of
 * its period) and, in test mode only, jump to day 30. Only the Owner gets these (the page passes `canChange`); the server refuses the others as well. `canStart`: no plan has been started yet (a trial is started once per workspace).
 */
export function PlanMoves({ words, state, canChange, canStart, cancelling, pickerHref, trialDays, actions }: { words: Words; state: BillingState; canChange: boolean; canStart: boolean; cancelling: boolean; pickerHref: string; trialDays: number; actions: PlanActions }) {
  const t = makeT(words);
  const { busy, error, run } = usePlanMove(t);
  const [asking, setAsking] = React.useState(false);
  if (!canChange) return null;
  const live = state === "trial_pending" || state === "trialing" || state === "active" || state === "past_due";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {state === "past_due" && actions.fix ? (
          <button type="button" className={btnMain} disabled={busy} onClick={() => run(actions.fix!)}>
            {t("plan.fix")}
          </button>
        ) : null}
        <Link href={pickerHref} className={live ? btnQuiet : btnMain}>
          {canStart ? t("plan.start", { days: trialDays }) : live ? t("plan.change") : t("plan.picker.title")}
        </Link>
        {live && !cancelling && !asking ? (
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(true)}>
            {t(state === "trialing" || state === "trial_pending" ? "plan.cancel.trial" : "plan.cancel.paid")}
          </button>
        ) : null}
        {live && state === "trialing" && actions.endTrial ? (
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => run(actions.endTrial!)}>
            {t("plan.testfwd")}
          </button>
        ) : null}
      </div>
      {live && state === "trialing" && actions.endTrial ? <p className={fieldHelp}>{t("plan.testfwd.note")}</p> : null}
      {asking ? (
        <div role="alertdialog" aria-label={t(state === "trialing" || state === "trial_pending" ? "plan.cancel.ask.trial" : "plan.cancel.ask.paid")} className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="font-medium">{t(state === "trialing" || state === "trial_pending" ? "plan.cancel.ask.trial" : "plan.cancel.ask.paid")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={btnMain} disabled={busy} onClick={() => run(actions.cancel, () => setAsking(false))}>
              {t("plan.cancel.yes")}
            </button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(false)}>
              {t("plan.cancel.no")}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
