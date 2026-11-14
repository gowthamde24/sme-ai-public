"use client";

import * as React from "react";

import { needsSecondStep } from "@/lib/api/plan-extras";

import type { AskHow, AskOutcome } from "@/lib/api/ask-consent";

import { AskFirstActions } from "../../ask-first/AskFirstActions";
import { btnMain, btnQuiet } from "../../ui";
import { makeT } from "../../words";
import type { TalkPlan } from "./script";
import type { TalkLive as Live } from "./use-talk-live";

type T = ReturnType<typeof makeT>;

/** The plan asks a second time (more than BIG_PLAN_PEOPLE people, or the API says so): only a real plan, never the made-up one. */
export const isBigPlan = (plan: TalkPlan): boolean => plan.people !== undefined && needsSecondStep({ count: plan.people, needsSecondConfirm: plan.extras?.needsSecondConfirm });

/**
 * The first tap on the plan's "Yes" of a BIG plan only opens the second question ("Really call 255 people?"); only the second tap sends the answer, marked as the second confirmation. `confirmingFor` is the plan it was opened for, so a new plan always starts at the first question.
 */
export function usePlanStep(live: Live) {
  const plan = live.plan;
  const id = plan?.what ?? "";
  const [confirmingFor, setConfirmingFor] = React.useState<string | null>(null);
  const [backedFor, setBackedFor] = React.useState<string | null>(null);
  // the API refused a plain yes with `second_yes_required` (the plan keeps waiting): that is not an error, it is the second question, even for a plan the client did not count as big
  const asked = live.secondAsked === true;
  const big = plan !== null && plan !== undefined && (isBigPlan(plan) || asked);
  const confirming = big && backedFor !== id && (confirmingFor === id || asked);
  return {
    big,
    confirming,
    onYes: () => {
      if (big) {
        setBackedFor(null);
        setConfirmingFor(id);
      } else live.decide("yes");
    },
    onConfirm: () => live.decide("yes", true),
    back: () => {
      setConfirmingFor(null);
      setBackedFor(id);
    },
  };
}
export type PlanStep = ReturnType<typeof usePlanStep>;

const yesBigKey = (plan: TalkPlan) => (plan.channel === "call" ? "dst.plan.big_yes_call" : plan.channel === "whatsapp" ? "dst.plan.big_yes_send" : "dst.plan.big_yes");
const questionKey = (plan: TalkPlan) => (plan.channel === "call" ? "dst.plan.big_call" : plan.channel === "whatsapp" ? "dst.plan.big_send" : "dst.plan.big_do");

/** The count and the money of a big plan, large: this is what the owner decides on. */
export function BigFigures({ plan, t }: { plan: TalkPlan; t: T }) {
  return (
    <p data-part="plan-big-figures" className="m-0 mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-display text-2xl font-extrabold tabular-nums text-brand-text">
      {plan.people != null ? <span>{t("bv.chat.plan.people", { n: plan.people })}</span> : null}
      {plan.cost ? <span>{plan.cost}</span> : null}
    </p>
  );
}

/** Who it is for, who has agreed and who must be asked first, and what is left of today's limit: only what the API said. Consent is strict for EVERY plan, any size (owner, 14 Nov): only people with consent are called, an unknown consent is "ask first" and is not called. `onAskConsent` (the WhatsApp opt-in; absent = no button) is given by whoever has the route. */
export function PlanExtraLines({ plan, t, onAskConsent }: { plan: TalkPlan; t: T; onAskConsent?: (how: AskHow) => Promise<AskOutcome> }) {
  const x = plan.extras;
  if (!x) return null;
  const { audience, consent, dailyCap } = x;
  if (!audience && !consent && !dailyCap) return null;
  // "ask first" = the people whose consent is UNKNOWN (reason `no_consent`); the others skipped (withdrawn, no phone, ...) are never asked
  const askN = consent ? (Object.keys(consent.reasonCounts).length > 0 ? (consent.reasonCounts.no_consent ?? 0) : consent.skipped) : 0;
  return (
    <div data-part="plan-extras" className="mt-2 grid gap-1 text-sm">
      {audience ? (
        <p data-part="plan-audience" className="m-0 font-semibold">
          {t("dst.plan.who", { label: audience.label })}
        </p>
      ) : null}
      {consent ? (
        <div data-part="plan-consent">
          <p className="m-0 text-muted">{t("dst.plan.consent", { callable: consent.callable })}</p>
          {consent.skipped > 0 ? (
            <>
              <p data-part="plan-ask-first" className="m-0 text-muted">
                {t("dst.plan.ask_first", { skipped: askN > 0 ? askN : consent.skipped })}
              </p>
              {consent.skippedSample.length > 0 ? (
                <details data-part="plan-skipped" className="mt-1">
                  <summary className="cursor-pointer text-brand-text">{t("dst.plan.skipped_list", { n: consent.skipped })}</summary>
                  <ul className="m-0 mt-1 list-disc pl-5 text-muted">
                    {consent.skippedSample.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {onAskConsent && askN > 0 ? <AskFirstActions t={t} people={askN} channel={plan.channel ?? null} onAsk={onAskConsent} compact /> : null}
            </>
          ) : null}
        </div>
      ) : null}
      {dailyCap ? (
        <p data-part="plan-cap" className="m-0 text-muted">
          {t("dst.plan.cap", { remaining: dailyCap.remaining, limit: dailyCap.limit })}
        </p>
      ) : null}
    </div>
  );
}

/** The second question, in place of the Yes / Change buttons. */
export function SecondStep({ plan, t, step, busy, mainClass = btnMain, quietClass = btnQuiet }: { plan: TalkPlan; t: T; step: PlanStep; busy: boolean; mainClass?: string; quietClass?: string }) {
  // the question is OUR words in the app's language, with the count (the API's `second_confirm_text` is not shown: owner, 14 Nov)
  const question = t(questionKey(plan), { n: plan.people ?? 0 });
  return (
    <div data-part="plan-second-step" role="group" aria-label={question} className="basis-full">
      <p className="m-0 text-base font-extrabold">{question}</p>
      {plan.cost ? <p className="m-0 mt-1 text-sm font-semibold text-brand-text">{t("dst.plan.big_money", { amount: plan.cost })}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={step.onConfirm} className={mainClass}>
          {t(yesBigKey(plan))}
        </button>
        <button type="button" disabled={busy} onClick={step.back} className={quietClass}>
          {t("dst.plan.big_back")}
        </button>
      </div>
    </div>
  );
}

/** The numbers a sentence about today's call limit needs: how many calls this plan has, how many are left today and the limit (from the plan card; 0 when it has none). */
export const capVars = (plan: TalkPlan | null | undefined): { count: number; remaining: number; limit: number } => ({ count: plan?.people ?? 0, remaining: plan?.extras?.dailyCap?.remaining ?? 0, limit: plan?.extras?.dailyCap?.limit ?? 0 });
