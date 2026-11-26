"use client";

import Link from "next/link";
import * as React from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";
import type { Done, Employee, EmployeeStatus, Refusal } from "@/lib/employees/types";

import { pillGreen, pillAmber, pillNeutral, btnQuiet, btnMain, surface, alertBox } from "../ui";
import { makeT, type Words } from "../words";

export type EmployeeListActions = { setStatus: (id: string, status: "on" | "paused") => Promise<Done<Employee>> };
const chip = (s: EmployeeStatus) => (s === "on" ? pillGreen : s === "paused" ? pillAmber : pillNeutral);

/** One card for each AI employee: a round initial, the name, the role, the languages, the status, today's calls, and Turn on or Pause. */
function Card({ e, base, words, actions }: { e: Employee; base: string; words: Words; actions: EmployeeListActions | null }) {
  const t = makeT(words);
  const [status, setStatus] = React.useState<EmployeeStatus>(e.status);
  const [error, setError] = React.useState<Refusal | null>(null);
  const [busy, start] = React.useTransition();
  const roleName = e.roleTitle ?? t(`emp.role.${e.roleCode}`);
  const langs = e.languages.map((l) => CALL_LANG_NAMES[l as CallLang] ?? l).join(" · ");
  const canSwitch = actions !== null && !e.isDefault;
  const next: "on" | "paused" = status === "on" ? "paused" : "on";
  const flip = () =>
    start(async () => {
      if (!actions) return;
      setError(null);
      const out = await actions.setStatus(e.id, next);
      if (out.ok) setStatus(out.data.status);
      else setError(out.error);
    });
  return (
    <li data-part="emp-card" data-employee={e.id} data-status={status} className={`${surface} flex flex-col gap-3`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-bg text-lg font-bold text-brand-text">
          {e.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[17px] font-semibold leading-snug text-ink">
            <Link href={`${base}/employees/${e.id}`} prefetch={false} className="text-ink no-underline hover:underline">
              {e.name}
            </Link>
          </h2>
          <p className="m-0 text-[15px] text-muted">{e.isDefault ? `${roleName} · ${t("emp.default")}` : roleName}</p>
        </div>
        <span className={chip(status)} data-part="emp-status">
          {t(`emp.status.${status}`)}
        </span>
      </div>
      <p className="m-0 text-sm text-muted">
        {langs}
        {langs ? " · " : ""}
        {e.callsToday === 0 ? t("emp.no_calls") : e.callsToday === 1 ? t("emp.calls_today.one") : t("emp.calls_today", { n: e.callsToday })}
      </p>
      {e.isDefault ? <p className="m-0 text-sm text-muted">{t("emp.default.d")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${base}/employees/${e.id}`} prefetch={false} className={btnQuiet}>
          {t("emp.open")}
        </Link>
        {canSwitch && status !== "archived" ? (
          <button type="button" disabled={busy} onClick={flip} data-part="emp-switch" className={status === "on" ? btnQuiet : btnMain}>
            {status === "on" ? t("emp.pause") : status === "paused" ? t("emp.resume") : t("emp.turn_on")}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {t(`emp.err.${error}`)}
        </p>
      ) : null}
    </li>
  );
}

/** The AI Team page (EMPLOYEES): the cards, the plan's limit and "New AI employee" (not offered at the cap: the plan's own sentence says why). */
export function EmployeeList({ employees, limit, words, base, actions, canAdd }: { employees: readonly Employee[]; limit: number; words: Words; base: string; actions: EmployeeListActions | null; canAdd: boolean }) {
  const t = makeT(words);
  const full = employees.length >= limit;
  return (
    <div data-part="emp-list" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm font-semibold text-muted" data-part="emp-count">
          {t("emp.count", { n: employees.length, limit })}
        </p>
        {canAdd && !full ? (
          <Link href={`${base}/employees/new`} prefetch={false} data-part="emp-new" className={btnMain}>
            {t("emp.new")}
          </Link>
        ) : null}
      </div>
      {canAdd && full ? (
        <p data-part="emp-limit" className="m-0 rounded-xl border border-line bg-surface-2 p-3 text-[15px] text-ink">
          {limit <= 1 ? t("emp.limit.trial") : t("emp.limit.full", { limit })}
        </p>
      ) : null}
      {!canAdd ? <p className="m-0 text-sm text-muted">{t("emp.only_owner")}</p> : null}
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
        {employees.map((e) => (
          <Card key={e.id} e={e} base={base} words={words} actions={actions} />
        ))}
      </ul>
      <p className="m-0">
        <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-brand-text underline underline-offset-2">
          {t("emp.jobs_link")}
        </Link>
      </p>
    </div>
  );
}
