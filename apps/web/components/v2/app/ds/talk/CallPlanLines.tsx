"use client";

import * as React from "react";

import type { CallPlan } from "@/lib/api/plan-extras";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The plan of a "find out" call, drawn on the plan card BEFORE anything is dialled (owner, 14 Nov): who (a masked number), the goal, how the call opens, the questions, and what the system really does after each outcome.
 * The questions are changed in words, like everything else: with `onSay` (the typed chat) each question has a Remove button and there is an "Add a question" line, and each sends an ordinary message ("remove question 2",
 * "also ask: ...") that makes a NEW card in the planner; without it (Talk live) the card says to say it. Every word of the plan itself (goal, opening, questions) is shown as the API wrote it, in the conversation's language.
 */
export function CallPlanLines({ plan, t: given, onSay, locked = false }: { plan: CallPlan; t: Say; onSay?: (text: string) => void; locked?: boolean }) {
  // the chat's words do not fill {placeholders} themselves: done here for both callers (a filled text has no braces left)
  const t: Say = (key, vars) => Object.entries(vars ?? {}).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), given(key, vars));
  const [extra, setExtra] = React.useState("");
  const more = plan.count - plan.people.length;
  return (
    <div data-part="call-plan" className="mt-2 grid gap-2 text-sm">
      {plan.people.length > 0 ? (
        <p data-part="call-plan-who" className="m-0">
          <span className="font-semibold">{t("bv.chat.plan.call.who")}</span>{" "}
          {plan.people.map((p) => (p.phoneMasked ? `${p.name} · ${p.phoneMasked}` : `${p.name} · ${t("bv.chat.plan.call.nonumber")}`)).join(", ")}
          {more > 0 ? ` ${t("bv.chat.plan.call.more", { n: more })}` : ""}
        </p>
      ) : null}
      <p data-part="call-plan-goal" className="m-0">
        <span className="font-semibold">{t("bv.chat.plan.call.goal")}</span> {plan.goal}
      </p>
      {plan.openingLine ? (
        <p data-part="call-plan-opening" className="m-0">
          <span className="font-semibold">{t("bv.chat.plan.call.opening")}</span>
          <q className="ml-1 italic [overflow-wrap:anywhere]">{plan.openingLine}</q>
        </p>
      ) : null}
      <div data-part="call-plan-questions">
        <p className="m-0 font-semibold">{t("bv.chat.plan.call.questions")}</p>
        <ol className="m-0 mt-1 list-decimal space-y-1 pl-5">
          {plan.questions.map((q, i) => (
            <li key={q.id} className="[overflow-wrap:anywhere]">
              <span>{q.text}</span>
              {onSay && !locked && plan.questions.length > 1 ? (
                <button type="button" data-call-plan="remove" aria-label={t("bv.chat.plan.call.remove", { n: i + 1 })} onClick={() => onSay(`remove question ${i + 1}`)} className="ml-2 inline-flex min-h-8 items-center rounded px-2 text-xs font-semibold text-brand-text underline underline-offset-2">
                  {t("bv.chat.plan.call.removebtn")}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {onSay && !locked ? (
          <form
            data-call-plan="add"
            onSubmit={(e) => {
              e.preventDefault();
              const text = extra.trim();
              if (text === "") return;
              setExtra("");
              onSay(`also ask: ${text}`);
            }}
            className="mt-1.5 flex gap-2"
          >
            <input type="text" value={extra} maxLength={200} onChange={(e) => setExtra(e.target.value)} aria-label={t("bv.chat.plan.call.add")} placeholder={t("bv.chat.plan.call.add")} autoComplete="off" className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm" />
            <button type="submit" disabled={extra.trim() === ""} className="inline-flex min-h-10 items-center rounded-md border border-edge bg-surface px-3 text-sm font-semibold disabled:opacity-60">
              {t("bv.chat.plan.call.addbtn")}
            </button>
          </form>
        ) : !locked ? (
          <p className="m-0 mt-1 text-xs text-muted">{t("bv.chat.plan.call.hint")}</p>
        ) : null}
      </div>
      {plan.outcomes.length > 0 ? (
        <div data-part="call-plan-outcomes">
          <p className="m-0 font-semibold">{t("bv.chat.plan.call.outcomes")}</p>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">
            {plan.outcomes.map((o, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="font-medium">{o.when}</span> → {o.then}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
