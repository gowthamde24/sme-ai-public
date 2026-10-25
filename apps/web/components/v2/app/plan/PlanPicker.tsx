"use client";

import Link from "next/link";
import * as React from "react";

import type { PlanDef } from "@/lib/plan/types";

import { btnMain, fieldHelp } from "../ui";
import { makeT, type Words } from "../words";
import type { PlanActions } from "./types";
import { usePlanMove } from "./use-plan-move";

const num = (n: number): string => new Intl.NumberFormat("en-IN").format(n);

/** One allowance as words: a count, "pay for what you use" (no cap), "not included" (0) or a dash (the plan does not say). */
function allowance(t: ReturnType<typeof makeT>, value: number | null, noCap: "plan.value.payg" | "plan.value.payg_messages" | null): string {
  if (value === null) return noCap ? t(noCap) : "—";
  return value === 0 ? t("plan.value.none") : num(value);
}

/**
 * The plan picker (job DK): the six plans side by side, from the plans data (no plan id is written here). Prices that are not set say "Price coming soon". Everything counted is call minutes, WhatsApp messages the business
 * starts, team members and workspaces; the AI is "included, fair use" and has no number. A business with no plan (or whose plan ended) can choose one and start the 30-day trial with a payment method (a test choice
 * in test mode); one that has had a plan (a trial is started once per workspace) or is not the Owner sees the comparison, its own plan marked, and why it cannot start one.
 */
export function PlanPicker({ words, main, calls, currentId, canStart, blocked, mock, trialDays, actions, done, resuming = false }: { words: Words; main: readonly PlanDef[]; calls: readonly PlanDef[]; currentId: string | null; canStart: boolean; blocked: "already" | "used" | "forbidden" | null; mock: boolean; trialDays: number; actions: PlanActions; done: string }) {
  const t = makeT(words);
  const [chosen, setChosen] = React.useState<string>("");
  const [method, setMethod] = React.useState<string>("");
  const [started, setStarted] = React.useState<string | null>(null);
  const { busy, error, run } = usePlanMove(t);
  const all = [...main, ...calls];
  const pick = all.find((p) => p.id === chosen) ?? null;
  const card = (p: PlanDef) => {
    const rows: [string, string][] = [
      [t("plan.row.minutes"), allowance(t, p.callMinutes, "plan.value.payg")],
      [t("plan.row.messages"), allowance(t, p.messages, "plan.value.payg_messages")],
      ...(p.kind === "main" ? ([[t("plan.row.users"), allowance(t, p.users, null)], [t("plan.row.workspaces"), allowance(t, p.workspaces, null)]] as [string, string][]) : []),
    ];
    const mine = p.id === currentId;
    return (
      <li key={p.id} data-plan={p.id} className={`rounded-xl border p-4 ${chosen === p.id ? "border-brand-edge bg-brand-bg" : "border-line bg-surface"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl font-semibold">{p.name}</h3>
          {mine ? <span className="rounded-full border border-brand-edge bg-brand-bg px-2.5 py-0.5 text-sm font-semibold text-brand-text">{t("plan.picker.current")}</span> : null}
        </div>
        <p className="mt-1 text-base">{p.priceInr === null ? t("plan.price.soon") : `₹${num(p.priceInr)}`}</p>
        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {canStart ? (
          <label className="mt-3 flex min-h-11 items-center gap-3 text-base font-semibold">
            <input type="radio" name="plan" value={p.id} checked={chosen === p.id} onChange={() => setChosen(p.id)} className="size-6 shrink-0 accent-brand-text" />
            {t(resuming ? "plan.resume.for" : "plan.start.for", { name: p.name, days: trialDays })}
          </label>
        ) : null}
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-6" data-picker>
      <p className="max-w-3xl text-base text-muted">{t(resuming ? "plan.resume.sub" : "plan.picker.sub", { days: trialDays })}</p>
      {mock ? (
        <p role="note" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
          {t("plan.testmode")}
        </p>
      ) : null}
      {blocked !== null ? <p className="text-sm font-medium">{t(`plan.err.${blocked}`)}</p> : null}
      <section aria-labelledby="picker-main-h">
        <h2 id="picker-main-h" className="mb-3 font-display text-2xl font-bold">
          {t("plan.picker.main")}
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">{main.map(card)}</ul>
      </section>
      <section aria-labelledby="picker-calls-h">
        <h2 id="picker-calls-h" className="font-display text-2xl font-bold">
          {t("plan.picker.calls")}
        </h2>
        <p className="mb-3 text-sm text-muted">{t("plan.picker.calls.sub")}</p>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">{calls.map(card)}</ul>
      </section>
      <p className="text-sm text-muted">{t("plan.picker.includes")}</p>
      {canStart && started === null ? (
        <form
          className="rounded-xl border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) run(() => actions.start(pick.id, method), () => setStarted(pick.name));
          }}
        >
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">{t("plan.method.label")}</legend>
            {(["test_ok", "test_fails", "test_declined"] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-3 text-base">
                <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="size-6 shrink-0 accent-brand-text" />
                {t(m === "test_ok" ? "plan.method.ok" : m === "test_fails" ? "plan.method.fails" : "plan.method.declined")}
              </label>
            ))}
          </fieldset>
          <p className={fieldHelp}>{t(resuming ? "plan.resume.sub" : "plan.picker.sub", { days: trialDays })}</p>
          <div className="mt-3">
            <button type="submit" className={btnMain} disabled={busy || !pick}>
              {pick ? t(resuming ? "plan.resume.for" : "plan.start.for", { name: pick.name, days: trialDays }) : t(resuming ? "plan.resume.go" : "plan.start.go")}
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-red-text">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {started !== null ? (
        <p role="status" className="rounded-lg border border-green-text bg-green-bg px-3 py-2 text-sm font-medium text-green-text">
          {t(resuming ? "plan.resume.done" : "plan.start.done", { name: started, days: trialDays })} <Link href={done} className="underline">{t("plan.title")}</Link>
        </p>
      ) : null}
    </div>
  );
}
