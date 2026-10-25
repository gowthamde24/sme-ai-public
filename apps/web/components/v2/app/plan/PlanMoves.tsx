"use client";

import Link from "next/link";
import * as React from "react";

import type { BillingState } from "@/lib/plan/types";

import { btnMain, btnQuiet, fieldHelp } from "../ui";
import { makeT, type Words } from "../words";
import type { PlanActions } from "./types";
import { usePlanMove } from "./use-plan-move";

/**
 * What the owner can DO on the Plan part (job DK): update a payment method that failed, go to the plans, cancel (asks once, and says nothing is charged when it is inside the trial), and, in test mode only, jump to day 30.
 * Only an Owner or Admin gets these (the page passes `canChange`); the server refuses the others as well.
 */
export function PlanMoves({ words, state, canChange, pickerHref, actions }: { words: Words; state: BillingState; canChange: boolean; pickerHref: string; actions: PlanActions }) {
  const t = makeT(words);
  const { busy, error, run } = usePlanMove(t);
  const [asking, setAsking] = React.useState(false);
  if (!canChange) return null;
  const live = state === "trialing" || state === "active" || state === "past_due";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {state === "past_due" ? (
          <button type="button" className={btnMain} disabled={busy} onClick={() => run(actions.fix)}>
            {t("plan.fix")}
          </button>
        ) : null}
        <Link href={pickerHref} className={live ? btnQuiet : btnMain}>
          {state === "none" || state === "cancelled" ? t("plan.start") : t("plan.change")}
        </Link>
        {live && !asking ? (
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(true)}>
            {t(state === "trialing" ? "plan.cancel.trial" : "plan.cancel.paid")}
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
        <div role="alertdialog" aria-label={t(state === "trialing" ? "plan.cancel.ask.trial" : "plan.cancel.ask.paid")} className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="font-medium">{t(state === "trialing" ? "plan.cancel.ask.trial" : "plan.cancel.ask.paid")}</p>
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
