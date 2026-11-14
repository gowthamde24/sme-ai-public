"use client";

import * as React from "react";

import { ATTEMPTS, CALL_AT, CALL_WITHIN, GAPS, REMINDERS, SPEED_SOURCES, type SpeedRule, type SpeedRules, type SpeedSource } from "@/lib/outreach/speed";
import type { Done } from "@/lib/outreach/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

type Say = ReturnType<typeof makeT>;
const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * Settings > My assistant > Rules > "How fast your assistant follows up" (Track D): ONE rule in plain words that every new enquiry follows (call within N minutes in calling hours; a WhatsApp message now and a call at 09:30 the next morning outside them; tries when nobody answers; a
 * hot lead goes to the owner), and, for any source that needs it, its own rule. Calling hours and the daily call limit are the existing settings and always apply. Saving changes only what happens to the NEXT enquiry; it needs the two-step code (the API asks), and only the Owner can save.
 */
export function SpeedToLead({ words, initial, canEdit, save, securityHref }: { words?: Words; initial: SpeedRules; canEdit: boolean; save: (rules: SpeedRules) => Promise<Done<SpeedRules>>; securityHref: string }) {
  const t = makeT(words);
  const [rules, setRules] = React.useState(initial);
  const [open, setOpen] = React.useState<SpeedSource | null>(null);
  const [busy, startSave] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const change = (next: SpeedRules) => {
    setRules(next);
    setDone(false);
  };
  const submit = () =>
    startSave(async () => {
      setError(null);
      setDone(false);
      const r = await save(rules);
      if (r.ok) {
        setRules(r.value);
        setDone(true);
      } else setError(r.error);
    });
  return (
    <section className={`${surface} flex flex-col gap-4`} aria-labelledby="stl-h" data-part="speed-to-lead">
      <div>
        <h2 id="stl-h" className="text-lg font-semibold text-ink">{t("stl.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("stl.sub")}</p>
      </div>
      <RuleFields t={t} id="stl-d" rule={rules.default} disabled={!canEdit} onChange={(r) => change({ ...rules, default: r })} />
      <div className="flex flex-col gap-2 border-t border-edge pt-3" data-part="stl-sources">
        <h3 className="text-base font-semibold text-ink">{t("stl.src.title")}</h3>
        <p className="text-sm text-muted">{t("stl.src.sub")}</p>
        <ul className="flex flex-col gap-2">
          {SPEED_SOURCES.map((kind) => {
            const own = rules.perSource[kind] ?? null;
            const isOpen = open === kind && own !== null;
            return (
              <li key={kind} className="rounded-xl bg-surface-2 p-3" data-source={kind} data-own={own ? "yes" : "no"}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{t(`sc.${kind}` as "sc.meta")}</span>
                  <span className="text-sm text-muted">{own ? t("stl.src.own") : t("stl.src.same")}</span>
                  {canEdit ? (
                    own ? (
                      <span className="flex gap-2">
                        <button type="button" className={btnQuiet} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : kind)}>{t("stl.src.edit")}</button>
                        <button type="button" className={btnQuiet} onClick={() => { change({ ...rules, perSource: { ...rules.perSource, [kind]: null } }); setOpen(null); }}>{t("stl.src.reset")}</button>
                      </span>
                    ) : (
                      <button type="button" className={btnQuiet} onClick={() => { change({ ...rules, perSource: { ...rules.perSource, [kind]: { ...rules.default } } }); setOpen(kind); }}>{t("stl.src.make")}</button>
                    )
                  ) : null}
                </div>
                {isOpen && own ? <div className="mt-3"><RuleFields t={t} id={`stl-${kind}`} rule={own} disabled={!canEdit} onChange={(r) => change({ ...rules, perSource: { ...rules.perSource, [kind]: r } })} /></div> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <p className={fieldHelp}>{t("stl.consent")}</p>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnMain} disabled={busy} onClick={submit}>{t("stl.save")}</button>
          <span className="text-sm text-muted">{t("stl.next")}</span>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("stl.owneronly")}</p>
      )}
      {error ? (
        <p role="alert" className={alertBox}>
          {t(`stl.err.${error === "mfa" || error === "forbidden" || error === "invalid" ? error : "down"}` as "stl.err.down")}
          {error === "mfa" ? <> <a href={securityHref} className="font-semibold underline">{t("today.err.mfa.link")}</a></> : null}
        </p>
      ) : null}
      {done ? <p role="status" className={okBox}>{t("stl.saved")}</p> : null}
    </section>
  );
}

function Select({ id, label, value, options, show, disabled, onChange }: { id: string; label: string; value: number; options: readonly number[]; show: (n: number) => string; disabled: boolean; onChange: (n: number) => void }) {
  const list = options.includes(value) ? options : [...options, value].sort((a, b) => a - b); // a value the API holds that is not on the usual list is still shown, never silently changed
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm font-semibold text-ink sm:flex-row sm:items-center sm:gap-3">
      <span className="sm:w-64">{label}</span>
      <select id={id} className={`${fieldInput} sm:max-w-48`} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {list.map((n) => <option key={n} value={n}>{show(n)}</option>)}
      </select>
    </label>
  );
}
function Check({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (c: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
      <input id={id} type="checkbox" className="h-5 w-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function RuleFields({ t, id, rule, disabled, onChange }: { t: Say; id: string; rule: SpeedRule; disabled: boolean; onChange: (r: SpeedRule) => void }) {
  const set = <K extends keyof SpeedRule>(k: K, v: SpeedRule[K]) => onChange({ ...rule, [k]: v });
  const min = (n: number) => t("stl.min", { n });
  return (
    <div className="flex flex-col gap-3" data-part="stl-rule">
      <Check id={`${id}-on`} label={t("stl.enabled")} checked={rule.enabled} disabled={disabled} onChange={(c) => set("enabled", c)} />
      {rule.enabled ? (
        <>
          <Select id={`${id}-within`} label={t("stl.within")} value={rule.callWithinMinutes} options={CALL_WITHIN} show={min} disabled={disabled} onChange={(n) => set("callWithinMinutes", n)} />
          <Check id={`${id}-wa`} label={t("stl.wa.now")} checked={rule.whatsappNow} disabled={disabled} onChange={(c) => set("whatsappNow", c)} />
          <Select id={`${id}-at`} label={t("stl.callat")} value={rule.callAtMinute} options={CALL_AT} show={clock} disabled={disabled} onChange={(n) => set("callAtMinute", n)} />
          <Select id={`${id}-tries`} label={t("stl.tries")} value={rule.maxAttempts} options={ATTEMPTS} show={(n) => t("stl.n.tries", { n })} disabled={disabled} onChange={(n) => set("maxAttempts", n)} />
          <Select id={`${id}-gap`} label={t("stl.gap")} value={rule.gapHours} options={GAPS} show={(n) => t("stl.n.hours", { n })} disabled={disabled} onChange={(n) => set("gapHours", n)} />
          <Check id={`${id}-then`} label={t("stl.then.wa")} checked={rule.thenWhatsapp} disabled={disabled} onChange={(c) => set("thenWhatsapp", c)} />
          <Check id={`${id}-hot`} label={t("stl.hot")} checked={rule.hotLead} disabled={disabled} onChange={(c) => set("hotLead", c)} />
          {rule.hotLead ? <Select id={`${id}-remind`} label={t("stl.hot.remind")} value={rule.reminderMinutes} options={REMINDERS} show={min} disabled={disabled} onChange={(n) => set("reminderMinutes", n)} /> : null}
        </>
      ) : (
        <p className="text-sm text-muted">{t("stl.off")}</p>
      )}
    </div>
  );
}
