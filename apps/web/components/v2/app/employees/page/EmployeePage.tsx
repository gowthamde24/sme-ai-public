"use client";

import Link from "next/link";
import * as React from "react";

import type { Employee, EmployeeStatus } from "@/lib/employees/types";

import { pillAmber, pillGreen, pillNeutral } from "../../ui";
import { makeT, type Words } from "../../words";
import { ActivityTab, OverviewTab, PhoneTab, ResponsibilitiesTab, RulesTab, VoiceTab } from "./LazyTabs";
import type { CatalogueVoice, LineChoice, PageActions } from "./shared";
import { TAB_KEYS, type TabKey } from "./tabs";

const chip = (s: EmployeeStatus) => (s === "on" ? pillGreen : s === "paused" ? pillAmber : pillNeutral);

export type EmployeePageProps = {
  employee: Employee;
  words: Words;
  lang: string;
  base: string;
  canEdit: boolean;
  actions: PageActions;
  initialTab: TabKey;
  /** the voices of the catalogue for each language (null = not listed now) and the address of a voice's recorded sample */
  catalogue: readonly CatalogueVoice[] | null;
  sampleEndpoint: string;
  /** the workspace's phone lines and the other employees' names by line id */
  lines: readonly LineChoice[] | null;
  takenBy: Readonly<Record<string, string>>;
};

/**
 * The page of ONE AI employee: its name and status on top, then real tabs (Overview, Voice and language, Rules, Responsibilities, Activity, Phone) with the arrow keys; the open tab is in the address (`?tab=`). Every tab body is a lazy chunk and, once opened, stays
 * (hidden) so a half-written change is not lost when someone looks at another tab. Everyone who may open the workspace reads; only Owner and Admin get the Save buttons.
 */
export function EmployeePage(props: EmployeePageProps) {
  const { words, base, canEdit, actions, lang } = props;
  const t = makeT(words);
  const [emp, setEmp] = React.useState<Employee>(props.employee);
  const [on, setOn] = React.useState<TabKey>(props.initialTab);
  const [seen, setSeen] = React.useState<ReadonlySet<TabKey>>(() => new Set([props.initialTab]));
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const open = (k: TabKey) => {
    setOn(k);
    setSeen((s) => (s.has(k) ? s : new Set([...s, k])));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", k);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch {
      /* the address is a convenience */
    }
  };
  const move = (to: number) => {
    const n = (to + TAB_KEYS.length) % TAB_KEYS.length;
    open(TAB_KEYS[n]);
    refs.current[n]?.focus();
  };
  const roleName = emp.roleTitle ?? t(`emp.role.${emp.roleCode}`);
  const common = { emp, words, canEdit, actions, onChange: setEmp, base };
  return (
    <div data-part="emp-page" data-employee={emp.id} lang={lang} className="flex flex-col gap-5">
      <Link href={`${base}/employees`} prefetch={false} className="inline-flex min-h-11 w-fit items-center text-[15px] font-semibold text-brand-text underline underline-offset-2">
        {t("emp.page.back")}
      </Link>
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-bg text-xl font-bold text-brand-text">
          {emp.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 break-words font-display text-2xl font-bold leading-tight text-ink sm:text-3xl" data-part="emp-name">
            {emp.name}
          </h1>
          <p className="m-0 text-[15px] text-muted">{emp.isDefault ? `${roleName} · ${t("emp.default")}` : roleName}</p>
        </div>
        <span className={chip(emp.status)} data-part="emp-status">
          {t(`emp.status.${emp.status}`)}
        </span>
      </header>
      {!canEdit ? (
        <p data-part="emp-readonly" className="m-0 text-[15px] text-muted">
          {t("emp.only_owner")}
        </p>
      ) : null}
      <div role="tablist" aria-label={t("emp.page.tabs")} className="-mx-4 flex gap-5 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {TAB_KEYS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`emp-tab-${k}`}
            aria-selected={on === k}
            aria-controls={`emp-panel-${k}`}
            tabIndex={on === k ? 0 : -1}
            onClick={() => open(k)}
            onKeyDown={(e) => {
              const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TAB_KEYS.length - 1 : null;
              if (to === null) return;
              e.preventDefault();
              move(to);
            }}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 text-[16px] ${on === k ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-muted"}`}
          >
            {t(`emp.page.tab.${k}`)}
          </button>
        ))}
      </div>
      {TAB_KEYS.map((k) => (
        <div key={k} role="tabpanel" id={`emp-panel-${k}`} aria-labelledby={`emp-tab-${k}`} hidden={on !== k} className="flex flex-col gap-4">
          {seen.has(k) ? (
            k === "overview" ? (
              <OverviewTab {...common} />
            ) : k === "voice" ? (
              <VoiceTab {...common} catalogue={props.catalogue} sampleEndpoint={props.sampleEndpoint} />
            ) : k === "rules" ? (
              <RulesTab {...common} />
            ) : k === "responsibilities" ? (
              <ResponsibilitiesTab {...common} />
            ) : k === "activity" ? (
              <ActivityTab {...common} lang={lang} />
            ) : (
              <PhoneTab {...common} lines={props.lines} takenBy={props.takenBy} />
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}
