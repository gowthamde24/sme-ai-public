"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FIELD_GROUP, diffOverride, overriddenFields, type OverridableField } from "@/lib/call-settings/campaign";
import { ACTIONS, MENU_ACTIONS, PURPOSES, SENSITIVITY, TOPICS, parseCallSettings, type CallSettings, type Purpose, type Topic } from "@/lib/call-settings/types";
import { DAYS } from "@/lib/assistant/types";

import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, mutedText, okBox, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";

export type CallSettingsActions = { save: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }> };
/** The same form for ONE campaign (job DQ part 3): it starts from what the campaign uses now, saves only what differs from the workspace's `base`, marks what is different here, hides the holidays, the hand-over people and what it may call about (those are the workspace's), and can go back to following the workspace. */
export type CampaignMode = { base: CallSettings; clear: () => Promise<{ ok: true } | { ok: false; error: string }>; settingsHref: string; backHref: string };
type Group = "retry" | "line" | "words" | "when" | "safety" | "memory";
const group = "flex flex-col gap-4 rounded-xl border border-line p-4";
const legend = "px-1 text-base font-semibold";
const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

function Num({ id, label, value, min, max, step = 1, onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))))} className={`${fieldInput} max-w-40`} />
    </div>
  );
}
function Check({ id, label, on, onChange }: { id: string; label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-base">
      <input id={id} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-6 shrink-0 accent-brand-text" />
      {label}
    </label>
  );
}
function Pick<T extends string>({ id, label, value, options, text, onChange }: { id: string; label: string; value: T; options: readonly T[]; text: (o: T) => string; onChange: (v: T) => void }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={fieldInput}>
        {options.map((o) => (
          <option key={o} value={o}>
            {text(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Settings > AI assistant > "Advanced: how calls behave" (job DP; C1's contract-call-settings.md): closed by default (the defaults suit most businesses), grouped as Trying again, On the line, Names and words, When it calls, Safety,
 * Hand-over by topic and Memory and what it may call about. Only the Owner saves (the API asks for the second factor); an Admin reads. A school sees the calls it may not make switched off, with the reason, and never as a
 * choice. The names and numbers of hand-over people are personal data: this part is drawn for Owner and Admin only (the page decides). `locked` = the only purposes the business type may switch on, or null.
 */
export function CallSettingsAdvanced({ words, initial, locked, canEdit, mock, saved, actions, campaign }: { /** Set for a campaign's own call settings (a page of its own, drawn open). */ campaign?: CampaignMode; words: Words; initial: CallSettings; locked: readonly Purpose[] | null; canEdit: boolean; mock: boolean; saved: boolean; actions: CallSettingsActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [s, setS] = React.useState<CallSettings>(initial);
  const [note, setNote] = React.useState<null | "saved" | "cleared" | "error" | "locked" | "read_only" | "mfa">(null);
  const [busy, setBusy] = React.useState(false);
  const set = (p: Partial<CallSettings>) => (setNote(null), setS((x) => ({ ...x, ...p })));
  const ok = parseCallSettings(s) !== null;
  const retry = (key: "retry_busy" | "retry_no_answer" | "retry_call_later") => (
    <div key={key} className="flex flex-wrap items-end gap-4">
      <p className="min-w-44 font-medium">{t(`calls.retry.${key.slice(6)}` as "calls.retry.busy")}</p>
      <Num id={`cs-${key}-n`} label={t("calls.retry.count")} value={s[key].count} min={0} max={5} onChange={(count) => set({ [key]: { ...s[key], count } })} />
      <Num id={`cs-${key}-g`} label={t("calls.retry.gap")} value={s[key].gap_minutes} min={5} max={1440} step={5} onChange={(gap_minutes) => set({ [key]: { ...s[key], gap_minutes } })} />
    </div>
  );
  const hours = s.hours;
  const differs: readonly OverridableField[] = campaign ? overriddenFields(campaign.base, s) : [];
  const badge = (g: Group) => (differs.some((f) => FIELD_GROUP[f] === g) ? <span data-different="" className="ml-2 rounded-full bg-brand-bg px-2.5 py-0.5 text-xs font-semibold text-brand-text">{t("calls.c.diff")}</span> : null);
  /** "Use my assistant's settings": removes the campaign's override and puts the workspace's values back in the form. */
  const clearIt = async (c: CampaignMode) => {
    setBusy(true);
    let out: { ok: true } | { ok: false; error: string };
    try {
      out = await c.clear();
    } catch {
      out = { ok: false, error: "not_available" };
    }
    setBusy(false);
    setNote(out.ok ? "cleared" : out.error === "mfa" ? "mfa" : out.error === "read_only" ? "read_only" : "error");
    if (out.ok) {
      setS(c.base);
      router.refresh();
    }
  };
  const allowed = (p: Purpose) => locked === null || locked.includes(p);
  return (
    <details data-settings={campaign ? "campaign-call-settings" : "call-settings"} data-call-settings-saved={saved ? "true" : "false"} open={campaign ? true : undefined} className={`${surface} group`}>
      <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center">
        <span className="font-display text-xl font-semibold">{t(campaign ? "calls.c.title" : "calls.title")}</span>
        <span className={mutedText + " !mt-0"}>{t(campaign ? "calls.c.intro" : "calls.intro")}</span>
      </summary>
      <form
        data-write
        className="mt-4 flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canEdit || !ok) return setNote("error");
          setBusy(true);
          let out: { ok: true } | { ok: false; error: string };
          try {
            out = await actions.save(campaign ? diffOverride(campaign.base, s) : s);
          } catch {
            out = { ok: false, error: "not_available" };
          }
          setBusy(false);
          setNote(out.ok ? "saved" : out.error === "mfa" ? "mfa" : out.error === "locked" ? "locked" : out.error === "read_only" ? "read_only" : "error");
          if (out.ok) router.refresh();
        }}
      >
        {mock ? (
          <p role="note" className={`${warnBox} !mt-0`}>
            {t("calls.mock")}
          </p>
        ) : null}
        {campaign ? (
          <p data-part="campaign-diff" className={`${mutedText} !mt-0`}>
            {differs.length > 0 ? t("calls.c.summary", { fields: differs.map((f) => t(`calls.f.${f}` as "calls.f.retry_busy")).join(", ") }) : t("calls.c.same")}
          </p>
        ) : null}
        <fieldset disabled={!canEdit || busy} className="contents">
          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.retry")}{badge("retry")}</legend>
            {(["retry_busy", "retry_no_answer", "retry_call_later"] as const).map(retry)}
            <Num id="cs-concurrent" label={t("calls.concurrent")} value={s.concurrent_calls} min={1} max={20} onChange={(concurrent_calls) => set({ concurrent_calls })} />
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.line")}{badge("line")}</legend>
            <Check id="cs-vm" label={t("calls.voicemail")} on={s.detect_voicemail} onChange={(detect_voicemail) => set({ detect_voicemail })} />
            {s.detect_voicemail ? <Pick id="cs-vm-a" label={t("calls.voicemail.action")} value={s.voicemail_action} options={ACTIONS} text={(o) => t(`calls.act.${o}` as "calls.act.hang_up")} onChange={(voicemail_action) => set({ voicemail_action })} /> : null}
            <Check id="cs-menu" label={t("calls.menu")} on={s.detect_phone_menu} onChange={(detect_phone_menu) => set({ detect_phone_menu })} />
            {s.detect_phone_menu ? <Pick id="cs-menu-a" label={t("calls.menu.action")} value={s.phone_menu_action} options={MENU_ACTIONS} text={(o) => t(`calls.act.${o}` as "calls.act.hang_up")} onChange={(phone_menu_action) => set({ phone_menu_action })} /> : null}
            <Num id="cs-silence" label={t("calls.silence")} value={s.silence_timeout_seconds} min={3} max={30} onChange={(silence_timeout_seconds) => set({ silence_timeout_seconds })} />
            <Num id="cs-max" label={t("calls.maxlen")} value={s.max_call_seconds} min={30} max={1800} step={30} onChange={(max_call_seconds) => set({ max_call_seconds })} />
            <Pick id="cs-int" label={t("calls.interrupt")} value={s.interruption_sensitivity} options={SENSITIVITY} text={(o) => t(`calls.int.${o}` as "calls.int.low")} onChange={(interruption_sensitivity) => set({ interruption_sensitivity })} />
            <Check id="cs-sounds" label={t("calls.sounds")} on={s.listening_sounds} onChange={(listening_sounds) => set({ listening_sounds })} />
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.words")}{badge("words")}</legend>
            <p className="font-medium">{t("calls.pron")}</p>
            {s.pronunciations.map((p, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor={`cs-pw-${i}`} className={fieldLabel}>
                    {t("calls.pron.written")}
                  </label>
                  <input id={`cs-pw-${i}`} value={p.written} maxLength={60} onChange={(e) => set({ pronunciations: s.pronunciations.map((x, j) => (j === i ? { ...x, written: e.target.value } : x)) })} className={fieldInput} />
                </div>
                <div>
                  <label htmlFor={`cs-ps-${i}`} className={fieldLabel}>
                    {t("calls.pron.spoken")}
                  </label>
                  <input id={`cs-ps-${i}`} value={p.spoken} maxLength={60} onChange={(e) => set({ pronunciations: s.pronunciations.map((x, j) => (j === i ? { ...x, spoken: e.target.value } : x)) })} className={fieldInput} />
                </div>
                <button type="button" className={btnQuiet} onClick={() => set({ pronunciations: s.pronunciations.filter((_, j) => j !== i) })}>
                  {t("calls.remove")}
                </button>
              </div>
            ))}
            {s.pronunciations.length < 50 ? (
              <div>
                <button type="button" className={btnQuiet} onClick={() => set({ pronunciations: [...s.pronunciations, { written: "", spoken: "" }] })}>
                  {t("calls.add")}
                </button>
              </div>
            ) : null}
            <div>
              <label htmlFor="cs-keywords" className={fieldLabel}>
                {t("calls.keywords")}
              </label>
              <textarea id="cs-keywords" rows={4} value={s.keywords.join("\n")} onChange={(e) => set({ keywords: e.target.value.split("\n").map((k) => k.trim()).filter(Boolean).slice(0, 100) })} className={`${fieldInput} py-2`} />
            </div>
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.when")}{badge("when")}</legend>
            <Check id="cs-follow" label={t("calls.hours.follow")} on={hours === null} onChange={(follow) => set({ hours: follow ? null : { days: [1, 2, 3, 4, 5, 6], from_minute: 540, to_minute: 1140 } })} />
            {hours ? (
              <>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label htmlFor="cs-from" className={fieldLabel}>
                      {t("asst.hours.from")}
                    </label>
                    <input id="cs-from" type="time" min="09:00" max="21:00" step={900} value={clock(hours.from_minute)} onChange={(e) => set({ hours: { ...hours, from_minute: minutes(e.target.value) } })} className={fieldInput} />
                  </div>
                  <div>
                    <label htmlFor="cs-to" className={fieldLabel}>
                      {t("asst.hours.to")}
                    </label>
                    <input id="cs-to" type="time" min="09:00" max="21:00" step={900} value={clock(hours.to_minute)} onChange={(e) => set({ hours: { ...hours, to_minute: minutes(e.target.value) } })} className={fieldInput} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("asst.hours.t")}>
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" aria-pressed={hours.days.includes(i + 1)} onClick={() => set({ hours: { ...hours, days: hours.days.includes(i + 1) ? hours.days.filter((x) => x !== i + 1) : [...hours.days, i + 1].sort() } })} className={chip(hours.days.includes(i + 1))}>
                      {t(`asst.day.${d}` as "asst.day.mon")}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {campaign ? null : <p className="font-medium">{t("calls.holidays")}</p>}
            {(campaign ? [] : s.holidays).map((d, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor={`cs-h-${i}`} className={fieldLabel}>
                    {t("calls.holidays.date")}
                  </label>
                  <input id={`cs-h-${i}`} type="date" value={d} onChange={(e) => set({ holidays: s.holidays.map((x, j) => (j === i ? e.target.value : x)) })} className={fieldInput} />
                </div>
                <button type="button" className={btnQuiet} onClick={() => set({ holidays: s.holidays.filter((_, j) => j !== i) })}>
                  {t("calls.remove")}
                </button>
              </div>
            ))}
            {!campaign && s.holidays.length < 60 ? (
              <div>
                <button type="button" className={btnQuiet} onClick={() => set({ holidays: [...s.holidays, new Date().toISOString().slice(0, 10)] })}>
                  {t("calls.add")}
                </button>
              </div>
            ) : null}
            <Num id="cs-week" label={t("calls.perweek")} value={s.max_calls_per_customer_per_week} min={1} max={14} onChange={(max_calls_per_customer_per_week) => set({ max_calls_per_customer_per_week })} />
          </fieldset>

          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.safety")}{badge("safety")}</legend>
            <Check id="cs-never" label={t("calls.autopause.never")} on={s.auto_pause_refusals_per_hour === null} onChange={(never) => set({ auto_pause_refusals_per_hour: never ? null : 10 })} />
            {s.auto_pause_refusals_per_hour !== null ? <Num id="cs-pause" label={t("calls.autopause")} value={s.auto_pause_refusals_per_hour} min={3} max={100} onChange={(auto_pause_refusals_per_hour) => set({ auto_pause_refusals_per_hour })} /> : null}
          </fieldset>

          {campaign ? null : <fieldset className={group}>
            <legend className={legend}>{t("calls.g.handover")}</legend>
            <p className={mutedText + " !mt-0"}>{t("calls.handover.note")}</p>
            {s.handover.map((h, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <Pick id={`cs-ht-${i}`} label={t("calls.handover.topic")} value={h.topic} options={TOPICS.filter((x) => x === h.topic || !s.handover.some((o) => o.topic === x)) as readonly Topic[]} text={(o) => t(`calls.topic.${o}` as "calls.topic.pricing")} onChange={(topic) => set({ handover: s.handover.map((x, j) => (j === i ? { ...x, topic } : x)) })} />
                <div>
                  <label htmlFor={`cs-hn-${i}`} className={fieldLabel}>
                    {t("calls.handover.person")}
                  </label>
                  <input id={`cs-hn-${i}`} value={h.person_name} maxLength={60} autoComplete="off" onChange={(e) => set({ handover: s.handover.map((x, j) => (j === i ? { ...x, person_name: e.target.value } : x)) })} className={fieldInput} />
                </div>
                <div>
                  <label htmlFor={`cs-hp-${i}`} className={fieldLabel}>
                    {t("calls.handover.phone")}
                  </label>
                  <input id={`cs-hp-${i}`} type="tel" inputMode="tel" value={h.phone} maxLength={16} autoComplete="off" onChange={(e) => set({ handover: s.handover.map((x, j) => (j === i ? { ...x, phone: e.target.value.replace(/[^\d+]/g, "") } : x)) })} className={fieldInput} />
                </div>
                <button type="button" className={btnQuiet} onClick={() => set({ handover: s.handover.filter((_, j) => j !== i) })}>
                  {t("calls.remove")}
                </button>
              </div>
            ))}
            {s.handover.length < Math.min(8, TOPICS.length) ? (
              <div>
                <button type="button" className={btnQuiet} onClick={() => set({ handover: [...s.handover, { topic: TOPICS.find((x) => !s.handover.some((o) => o.topic === x)) ?? "other", person_name: "", phone: "+91" }] })}>
                  {t("calls.add")}
                </button>
              </div>
            ) : null}
          </fieldset>}

          <fieldset className={group}>
            <legend className={legend}>{t("calls.g.memory")}{badge("memory")}</legend>
            <Check id="cs-memory" label={t("calls.memory")} on={s.contact_memory} onChange={(contact_memory) => set({ contact_memory })} />
            {campaign ? <p className={mutedText + " !mt-0"}>{t("calls.c.hidden")}</p> : <p className="font-medium">{t("calls.purposes")}</p>}
            {(campaign ? [] : PURPOSES).map((p) => (
              <Check key={p} id={`cs-p-${p}`} label={t(`calls.purpose.${p}` as "calls.purpose.sales_followup")} on={s.allowed_purposes.includes(p) && allowed(p)} onChange={(on) => allowed(p) && set({ allowed_purposes: on ? PURPOSES.filter((x) => x === p || s.allowed_purposes.includes(x)) : s.allowed_purposes.filter((x) => x !== p) })} />
            ))}
            {locked !== null ? <p className={mutedText + " !mt-0"}>{t("calls.school")}</p> : null}
          </fieldset>
        </fieldset>

        {note === "saved" || note === "cleared" ? (
          <p role="status" className={okBox + " !mt-0"}>
            {t(note === "cleared" ? "calls.c.cleared" : "calls.saved")}
          </p>
        ) : null}
        {note === "error" || note === "locked" || note === "read_only" || note === "mfa" ? (
          <p role="alert" className={alertBox + " !mt-0"}>
            {t(note === "mfa" ? "today.err.mfa" : note === "locked" ? "calls.err.locked" : note === "read_only" ? "calls.err.readonly" : "calls.err")}{" "}
            {note === "mfa" ? (
              <Link href="/app/security" className="font-semibold underline">
                {t("today.err.mfa.link")}
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={btnMain} disabled={!canEdit || busy || !ok}>
            {t("calls.save")}
          </button>
          {campaign ? (
            <>
              <button type="button" className={btnQuiet} disabled={!canEdit || busy || (differs.length === 0 && !saved)} onClick={() => void clearIt(campaign)}>
                {t("calls.c.clear")}
              </button>
              <Link href={campaign.settingsHref} className="font-semibold text-brand-text underline">
                {t("calls.c.ws")}
              </Link>
            </>
          ) : null}
        </div>
      </form>
    </details>
  );
}
