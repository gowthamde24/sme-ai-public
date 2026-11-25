"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FIELD_GROUP, diffOverride, overriddenFields, type OverridableField } from "@/lib/call-settings/campaign";
import { ACTIONS, MENU_ACTIONS, PURPOSES, SENSITIVITY, TOPICS, parseCallSettings, type CallSettings, type Purpose, type Topic } from "@/lib/call-settings/types";
import { DAYS } from "@/lib/assistant/types";
import { fmtMinutes } from "@/lib/jobs/detail";
import { retryTimes } from "@/lib/jobs/rules-effect";

import { JobChip } from "../ds/JobChip";
import { Tick } from "../ds/Tick";
import { jobCard } from "../jobs/detail/types";
import { Choose, EffectBox, MoreChoices, PillNum, Sentence, clockWord, countText, gapText, secondsText, withCurrent } from "../jobs/rules/parts";
import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, mutedText, okBox, warnBox } from "../ui";
import { makeT } from "../words";
import type { CallSettingsActions, CampaignMode } from "./CallSettingsAdvanced";

type Group = "retry" | "line" | "words" | "when" | "safety" | "memory";
type Props = { campaign?: CampaignMode; words: Parameters<typeof makeT>[0]; initial: CallSettings; locked: readonly Purpose[] | null; canEdit: boolean; mock: boolean; saved: boolean; actions: CallSettingsActions };

/** The tries: 0 to 5 more times. The pauses between them: a short list of the common ones (a saved value outside it still shows and stays). */
const COUNTS = [0, 1, 2, 3, 4, 5] as const;
const GAPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440] as const;
/** Times of the calling hours: every 15 minutes between 10:00 am and 9:00 pm (the same range as the old time boxes). */
const TIMES = Array.from({ length: 45 }, (_, i) => 600 + i * 15);
const range = (from: number, to: number, step = 1): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const chip = (on: boolean) => `jb-press min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const sub = "m-0 font-display text-[15px] font-bold text-ink";

/**
 * Call settings, the JOBS way (the simplicity pass): the four things most people look at are plain sentences with the choice inside ("If nobody answers, call again [2 more times], [2 hours] apart."), what it will do for an example customer, and everything else
 * under "More choices" on the same page. Every setting of the old form is still here, with the same limits and the same save (the API asks the Owner's second step); an Admin reads. A school sees the calls it may not make switched off, with the reason.
 * It is the same form for ONE campaign too (`campaign`): it saves only what differs from the workspace and marks what is different.
 */
export function CallSettingsSimple({ words, initial, locked, canEdit, mock, saved, actions, campaign }: Props) {
  const t = makeT(words);
  const router = useRouter();
  const [s, setS] = React.useState<CallSettings>(initial);
  const [note, setNote] = React.useState<null | "saved" | "cleared" | "error" | "locked" | "read_only" | "mfa">(null);
  const [busy, setBusy] = React.useState(false);
  const set = (p: Partial<CallSettings>) => (setNote(null), setS((x) => ({ ...x, ...p })));
  const ok = parseCallSettings(s) !== null;
  const hours = s.hours;
  const differs: readonly OverridableField[] = campaign ? overriddenFields(campaign.base, s) : [];
  const badge = (g: Group) => (differs.some((f) => FIELD_GROUP[f] === g) ? <JobChip tone="info"><span data-different="">{t("calls.c.diff")}</span></JobChip> : null);
  const allowed = (p: Purpose) => locked === null || locked.includes(p);

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

  /** One "call again [count], [gap] apart" sentence for one kind of try. */
  const retry = (key: "retry_busy" | "retry_no_answer" | "retry_call_later", tpl: string) => (
    <Sentence
      key={key}
      line={key}
      template={t(tpl)}
      parts={{
        count: (aria) => <Choose aria={aria} value={String(s[key].count)} options={COUNTS.map(String)} text={(v) => countText(t, Number(v))} onChange={(v) => set({ [key]: { ...s[key], count: Number(v) } })} />,
        gap: (aria) => <Choose aria={`${aria} (2)`} value={String(s[key].gap_minutes)} options={withCurrent(GAPS, s[key].gap_minutes).map(String)} text={(v) => gapText(t, Number(v))} onChange={(v) => set({ [key]: { ...s[key], gap_minutes: Number(v) } })} />,
      }}
    />
  );
  const timeOptions = (cur: number) => withCurrent(TIMES, cur).map(String);

  const eff = retryTimes(s.retry_no_answer.count, s.retry_no_answer.gap_minutes, hours ? { fromMinute: hours.from_minute, toMinute: hours.to_minute } : null).filter((x) => x < 2880);
  const effText =
    eff.length === 0
      ? t("jobs.rules.cs.effect.none", { who: t("jobs.rules.who"), t1: fmtMinutes(600) })
      : t("jobs.rules.cs.effect.tries", { who: t("jobs.rules.who"), t1: fmtMinutes(600), times: eff.map((x) => clockWord(t, x)).join(", ") });

  return (
    <details data-settings={campaign ? "campaign-call-settings" : "call-settings"} data-simple="" data-call-settings-saved={saved ? "true" : "false"} open={campaign ? true : undefined} className={`${jobCard} group`}>
      <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center [&::-webkit-details-marker]:hidden">
        <span className="font-display text-[17px] font-bold leading-tight">{t(campaign ? "calls.c.title" : "calls.title")}</span>
        <span className={mutedText + " !mt-0"}>{t(campaign ? "calls.c.intro" : "calls.intro")}</span>
      </summary>
      <form
        data-write
        className="mt-4 flex flex-col gap-4"
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
          <div data-part="cs-main" className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {retry("retry_no_answer", "jobs.rules.cs.noans")}
              {badge("retry")}
            </div>
            <Tick label={t("calls.hours.follow")} checked={hours === null} onChange={(e) => set({ hours: e.target.checked ? null : { days: [1, 2, 3, 4, 5, 6], from_minute: 600, to_minute: 1140 } })} />
            {hours ? (
              <>
                <Sentence
                  line="hours"
                  template={t("jobs.rules.cs.hours")}
                  parts={{
                    from: (aria) => <Choose aria={`${t("asst.hours.from")}: ${aria}`} value={String(hours.from_minute)} options={timeOptions(hours.from_minute)} text={(v) => fmtMinutes(Number(v))} onChange={(v) => set({ hours: { ...hours, from_minute: Number(v) } })} />,
                    to: (aria) => <Choose aria={`${t("asst.hours.to")}: ${aria}`} value={String(hours.to_minute)} options={timeOptions(hours.to_minute)} text={(v) => fmtMinutes(Number(v))} onChange={(v) => set({ hours: { ...hours, to_minute: Number(v) } })} />,
                  }}
                />
                <div className="flex flex-wrap gap-2 pb-1" role="group" aria-label={t("asst.hours.t")}>
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" aria-pressed={hours.days.includes(i + 1)} onClick={() => set({ hours: { ...hours, days: hours.days.includes(i + 1) ? hours.days.filter((x) => x !== i + 1) : [...hours.days, i + 1].sort() } })} className={chip(hours.days.includes(i + 1))}>
                      {t(`asst.day.${d}` as "asst.day.mon")}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {badge("when")}
            <Sentence line="week" template={t("jobs.rules.cs.week")} parts={{ n: (aria) => <Choose aria={aria} value={String(s.max_calls_per_customer_per_week)} options={range(1, 14).map(String)} text={(v) => v} onChange={(v) => set({ max_calls_per_customer_per_week: Number(v) })} /> }} />
            <Tick label={t("calls.autopause.never")} checked={s.auto_pause_refusals_per_hour === null} onChange={(e) => set({ auto_pause_refusals_per_hour: e.target.checked ? null : 10 })} />
            {s.auto_pause_refusals_per_hour !== null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Sentence line="pause" template={t("jobs.rules.cs.pause")} parts={{ n: (aria) => <PillNum aria={aria} min={3} max={100} value={String(s.auto_pause_refusals_per_hour)} onChange={(v) => set({ auto_pause_refusals_per_hour: Math.max(3, Math.min(100, Math.round(Number(v) || 3))) })} /> }} />
                {badge("safety")}
              </div>
            ) : (
              badge("safety")
            )}
          </div>

          <EffectBox label={t("jobs.rules.effect")} text={effText} />

          <MoreChoices title={t("jobs.rules.more")} sub={t("jobs.rules.cs.more_sub")}>
            <h3 className={sub}>
              {t("calls.g.retry")} {badge("retry")}
            </h3>
            {retry("retry_busy", "jobs.rules.cs.busy")}
            {retry("retry_call_later", "jobs.rules.cs.later")}
            <Sentence line="concurrent" template={t("jobs.rules.cs.concurrent")} parts={{ n: (aria) => <Choose aria={aria} value={String(s.concurrent_calls)} options={range(1, 20).map(String)} text={(v) => v} onChange={(v) => set({ concurrent_calls: Number(v) })} /> }} />

            <h3 className={sub}>
              {t("calls.g.line")} {badge("line")}
            </h3>
            <Tick label={t("calls.voicemail")} checked={s.detect_voicemail} onChange={(e) => set({ detect_voicemail: e.target.checked })} />
            {s.detect_voicemail ? <Sentence line="voicemail" template={t("jobs.rules.cs.voicemail")} parts={{ action: (aria) => <Choose aria={aria} value={s.voicemail_action} options={ACTIONS} text={(v) => t(`calls.act.${v}` as "calls.act.hang_up")} onChange={(v) => set({ voicemail_action: v as CallSettings["voicemail_action"] })} /> }} /> : null}
            <Tick label={t("calls.menu")} checked={s.detect_phone_menu} onChange={(e) => set({ detect_phone_menu: e.target.checked })} />
            {s.detect_phone_menu ? <Sentence line="menu" template={t("jobs.rules.cs.menu")} parts={{ action: (aria) => <Choose aria={aria} value={s.phone_menu_action} options={MENU_ACTIONS} text={(v) => t(`calls.act.${v}` as "calls.act.hang_up")} onChange={(v) => set({ phone_menu_action: v as CallSettings["phone_menu_action"] })} /> }} /> : null}
            <Sentence line="silence" template={t("jobs.rules.cs.silence")} parts={{ n: (aria) => <Choose aria={aria} value={String(s.silence_timeout_seconds)} options={range(3, 30).map(String)} text={(v) => secondsText(t, Number(v))} onChange={(v) => set({ silence_timeout_seconds: Number(v) })} /> }} />
            <Sentence line="maxlen" template={t("jobs.rules.cs.maxlen")} parts={{ n: (aria) => <Choose aria={aria} value={String(s.max_call_seconds)} options={range(30, 1800, 30).map(String)} text={(v) => secondsText(t, Number(v))} onChange={(v) => set({ max_call_seconds: Number(v) })} /> }} />
            <Sentence line="interrupt" template={t("jobs.rules.cs.interrupt")} parts={{ level: (aria) => <Choose aria={aria} value={s.interruption_sensitivity} options={SENSITIVITY} text={(v) => t(`calls.int.${v}` as "calls.int.low")} onChange={(v) => set({ interruption_sensitivity: v as CallSettings["interruption_sensitivity"] })} /> }} />
            <Tick label={t("calls.sounds")} checked={s.listening_sounds} onChange={(e) => set({ listening_sounds: e.target.checked })} />

            <h3 className={sub}>
              {t("calls.g.words")} {badge("words")}
            </h3>
            <p className="m-0 font-medium">{t("calls.pron")}</p>
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

            {campaign ? null : (
              <>
                <h3 className={sub}>{t("calls.holidays")}</h3>
                {s.holidays.map((d, i) => (
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
                {s.holidays.length < 60 ? (
                  <div>
                    <button type="button" className={btnQuiet} onClick={() => set({ holidays: [...s.holidays, new Date().toISOString().slice(0, 10)] })}>
                      {t("calls.add")}
                    </button>
                  </div>
                ) : null}

                <h3 className={sub}>{t("calls.g.handover")}</h3>
                <p className={mutedText + " !mt-0"}>{t("calls.handover.note")}</p>
                {s.handover.map((h, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor={`cs-ht-${i}`} className={fieldLabel}>
                        {t("calls.handover.topic")}
                      </label>
                      <select id={`cs-ht-${i}`} value={h.topic} onChange={(e) => set({ handover: s.handover.map((x, j) => (j === i ? { ...x, topic: e.target.value as Topic } : x)) })} className={fieldInput}>
                        {(TOPICS.filter((x) => x === h.topic || !s.handover.some((o) => o.topic === x)) as readonly Topic[]).map((o) => (
                          <option key={o} value={o}>
                            {t(`calls.topic.${o}` as "calls.topic.pricing")}
                          </option>
                        ))}
                      </select>
                    </div>
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
              </>
            )}

            <h3 className={sub}>
              {t("calls.g.memory")} {badge("memory")}
            </h3>
            <Tick label={t("calls.memory")} checked={s.contact_memory} onChange={(e) => set({ contact_memory: e.target.checked })} />
            {campaign ? <p className={mutedText + " !mt-0"}>{t("calls.c.hidden")}</p> : <p className="m-0 font-medium">{t("calls.purposes")}</p>}
            {(campaign ? [] : PURPOSES).map((p) => (
              <Tick key={p} label={t(`calls.purpose.${p}` as "calls.purpose.sales_followup")} checked={s.allowed_purposes.includes(p) && allowed(p)} onChange={(e) => allowed(p) && set({ allowed_purposes: e.target.checked ? PURPOSES.filter((x) => x === p || s.allowed_purposes.includes(x)) : s.allowed_purposes.filter((x) => x !== p) })} />
            ))}
            {locked !== null ? <p className={mutedText + " !mt-0"}>{t("calls.school")}</p> : null}
          </MoreChoices>
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
