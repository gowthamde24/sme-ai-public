"use client";

import { StatusSwitch } from "../../ds/StatusSwitch";
import * as React from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";
import { NAME_MAX, ROLE_CODES, ROLE_TITLE_MAX, ROLE_TITLE_MIN, isRole, type EmployeePatch } from "@/lib/employees/types";

import { btnQuiet, fieldInput, fieldLabel, pillAmber, pillGreen, pillNeutral } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, TextField, useSave, type TabProps } from "./shared";

/** Overview: the status with Turn on, Pause and Archive (Archive asks first), the name and the role, today's calls, the languages and one short summary. */
export function OverviewTab({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const [name, setName] = React.useState(emp.name);
  const [role, setRole] = React.useState<string>(emp.roleCode);
  const [title, setTitle] = React.useState(emp.roleTitle ?? "");
  const [confirm, setConfirm] = React.useState(false);
  const details = useSave(onChange);
  const status = useSave(onChange);
  const langs = emp.languages.map((l) => CALL_LANG_NAMES[l as CallLang] ?? l).join(" · ");
  const chip = emp.status === "on" ? pillGreen : emp.status === "paused" ? pillAmber : pillNeutral;
  const canSwitch = canEdit && !emp.isDefault && emp.status !== "archived";

  const patch = (): EmployeePatch | null => {
    const out: EmployeePatch = {};
    const n = name.trim();
    if (n !== emp.name) out.name = n;
    if (role !== emp.roleCode && isRole(role)) out.roleCode = role;
    const tt = title.trim();
    if (tt !== (emp.roleTitle ?? "")) out.roleTitle = tt === "" ? null : tt;
    return Object.keys(out).length ? out : null;
  };
  const save = () => {
    const p = patch();
    if (!p) return;
    if (p.name !== undefined && (p.name.length < 1 || p.name.length > NAME_MAX)) return details.fail("validation_error");
    if (typeof p.roleTitle === "string" && (p.roleTitle.length < ROLE_TITLE_MIN || p.roleTitle.length > ROLE_TITLE_MAX)) return details.fail("validation_error");
    void details.run(() => actions.patch(p));
  };
  const move = (to: "on" | "paused" | "archived") => {
    setConfirm(false);
    void status.run(() => actions.setStatus(to));
  };

  return (
    <>
      <Card title={t("emp.page.ov.status")} desc={emp.isDefault ? t("emp.default.d") : undefined}>
        <div className="flex flex-wrap items-center gap-3">
          {canSwitch && (emp.status === "on" || emp.status === "paused") ? (
            <StatusSwitch on={emp.status === "on"} label={emp.name} onText={t("emp.status.on")} offText={t("emp.status.paused")} busy={status.busy} onChange={(next) => move(next ? "on" : "paused")} />
          ) : (
            <span className={chip} data-part="emp-status-chip">
              {t(`emp.status.${emp.status}`)}
            </span>
          )}
          {canSwitch && emp.status === "draft" ? (
            <button type="button" disabled={status.busy} onClick={() => move("on")} data-part="emp-turn-on" className={btnQuiet}>
              {t("emp.turn_on")}
            </button>
          ) : null}
          {canSwitch && !confirm ? (
            <button type="button" disabled={status.busy} onClick={() => setConfirm(true)} data-part="emp-archive" className={btnQuiet}>
              {t("emp.page.archive")}
            </button>
          ) : null}
        </div>
        {confirm ? (
          <div role="alertdialog" aria-label={t("emp.page.archive")} data-part="emp-archive-confirm" className="flex flex-col gap-3 rounded-xl border border-amber-text bg-amber-bg p-3 text-amber-text">
            <p className="m-0 font-medium">{t("emp.page.archive.confirm")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => move("archived")} data-part="emp-archive-yes" className={btnQuiet}>
                {t("emp.page.archive.yes", { name: emp.name })}
              </button>
              <button type="button" onClick={() => setConfirm(false)} data-part="emp-archive-no" className={btnQuiet}>
                {t("emp.page.archive.no")}
              </button>
            </div>
          </div>
        ) : null}
        {status.error ? (
          <p role="alert" className="m-0 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text">
            {t(`emp.err.${status.error}`)}
          </p>
        ) : null}
        {status.saved ? (
          <p role="status" className="m-0 text-[15px] font-semibold text-green-text">
            {t("emp.page.saved")}
          </p>
        ) : null}
      </Card>

      <Card title={t("emp.page.ov.today")}>
        <p className="m-0 text-base text-ink" data-part="emp-today">
          {emp.callsToday === 0 ? t("emp.no_calls") : emp.callsToday === 1 ? t("emp.calls_today.one") : t("emp.calls_today", { n: emp.callsToday })}
        </p>
        <p className="m-0 text-[15px] text-muted" data-part="emp-langs">
          {langs ? t("emp.page.ov.speaks", { languages: langs }) : t("emp.page.ov.no_language")}
        </p>
        <p className="m-0 text-[15px] text-muted" data-part="emp-summary">
          {t("emp.page.ov.summary", { name: emp.name, role: emp.roleTitle ?? t(`emp.role.${emp.roleCode}`), n: emp.responsibilities.length })}
        </p>
      </Card>

      <Card title={t("emp.page.ov.about")}>
        <TextField id="emp-name" label={t("emp.page.ov.name")} value={name} max={NAME_MAX} disabled={!canEdit} onChange={(v) => (setName(v), details.clear())} />
        <div>
          <label htmlFor="emp-role" className={fieldLabel}>
            {t("emp.page.ov.role")}
          </label>
          <select id="emp-role" value={role} disabled={!canEdit} onChange={(e) => (setRole(e.target.value), details.clear())} className={fieldInput}>
            {ROLE_CODES.map((r) => (
              <option key={r} value={r}>
                {t(`emp.role.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <TextField id="emp-title" label={t("emp.page.ov.title")} help={t("emp.page.ov.title_help", { min: ROLE_TITLE_MIN, max: ROLE_TITLE_MAX })} value={title} max={ROLE_TITLE_MAX} disabled={!canEdit} onChange={(v) => (setTitle(v), details.clear())} />
        {canEdit ? <SaveBar words={words} state={details} onSave={save} disabled={patch() === null} /> : null}
      </Card>
    </>
  );
}
