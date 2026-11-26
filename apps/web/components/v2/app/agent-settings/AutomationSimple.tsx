"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { EVENING_HOURS, type SchedulerSettings } from "@/lib/api/scheduler";
import { QUIET_END, QUIET_START, type OutboxSettings } from "@/lib/api/outbox";

import { cardBox } from "../Card";
import { JobChip } from "../ds/JobChip";
import { Tick } from "../ds/Tick";
import { PillSelect } from "../jobs/detail/SettingLines";
import { SelectField } from "../settings/simple/fields";
import { makeT, type Say } from "../words";
import { errorLine, okLine, primary } from "../visits/styles";
import {
  autoEffects,
  durText,
  hourText,
  type AutoValues,
} from "./automation-effect";
import type { AgentResult, AgentSettingsActions } from "./types";

const range = (r: { min: number; max: number }) =>
  Array.from({ length: r.max - r.min + 1 }, (_, i) => String(r.min + i));
const LIMITS = range({ min: 1, max: 20 });
const QUIET_STARTS = range(QUIET_START);
const QUIET_ENDS = range(QUIET_END);
const EVENING = range(EVENING_HOURS);
const HEADS = [60, 90, 120, 150, 180, 240, 300, 360, 420, 480];
const NO_SHOW = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
const choices = (list: number[], current: string) => [
  "off",
  ...(list.includes(Number(current))
    ? list
    : [...list, Number(current)].sort((a, b) => a - b)
  ).map(String),
];

const PlainCtx = React.createContext(false);
const plainCard = `${cardBox} flex flex-col gap-4`;
const plainFx = "m-0 text-[14px] text-muted";
const jobsCard =
  "flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";
const heading = "m-0 font-display text-[17px] font-bold leading-tight text-ink";
const effectBox =
  "m-0 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink";

/** A sentence with the choices inside it: `{key}` in the template is replaced by a pill select (the whole sentence, without the choice, names it for a screen reader). */
function Sentence({
  id,
  template,
  pills,
  labels,
}: {
  id: string;
  template: string;
  /** SETTINGS_OPEN: the plain label of each choice (the sentence is not drawn). */
  labels?: Readonly<Record<string, string>>;
  pills: Readonly<
    Record<
      string,
      {
        value: string;
        options: readonly string[];
        text: (v: string) => string;
        onChange: (v: string) => void;
      }
    >
  >;
}) {
  const plain = template.replace(/\{\w+\}/g, "…");
  const keys = Object.keys(pills);
  const open = React.useContext(PlainCtx);
  if (open && labels) {
    return (
      <div data-setting-line={id} className={keys.length > 1 ? "grid grid-cols-1 gap-5 sm:grid-cols-2" : ""}>
        {keys.map((k) => (
          <SelectField key={k} label={labels[k] ?? plain} value={pills[k].value} options={pills[k].options.map((o) => ({ value: o, label: pills[k].text(o) }))} onChange={pills[k].onChange} />
        ))}
      </div>
    );
  }
  return (
    <p
      data-setting-line={id}
      className="m-0 text-[16px] leading-[2.3] text-ink"
    >
      {template.split(/(\{\w+\})/g).map((part, i) => {
        const key = /^\{(\w+)\}$/.exec(part)?.[1];
        const p = key ? pills[key] : undefined;
        if (!key || !p) return <React.Fragment key={i}>{part}</React.Fragment>;
        return (
          <PillSelect
            key={i}
            label={
              keys.length > 1 ? `${plain} (${keys.indexOf(key) + 1})` : plain
            }
            value={p.value}
            options={p.options}
            optionText={p.text}
            disabled={false}
            onChange={p.onChange}
          />
        );
      })}
    </p>
  );
}

function fromRecord(
  sending: OutboxSettings,
  reminders: SchedulerSettings | null,
): AutoValues {
  return {
    auto: sending.auto_send_enabled,
    limit: String(sending.per_customer_daily_limit),
    quietStart: String(sending.quiet_hours_start),
    quietEnd: String(sending.quiet_hours_end),
    evening: reminders?.reminder_evening_enabled ?? false,
    eveningHour: String(reminders?.reminder_evening_hour ?? 18),
    heads: reminders?.reminder_heads_up_enabled ?? false,
    headsMinutes: String(reminders?.reminder_heads_up_minutes ?? 120),
    noShow: reminders?.no_show_enabled ?? false,
    noShowMinutes: String(reminders?.no_show_after_minutes ?? 30),
  };
}

/**
 * Settings > Automation under JOBS (decision-ai-team "Simplicity rules"): the three forms of before (automatic sending, quiet hours, visit reminders) as ONE page of plain sentences with the choice inside, a "What it will do" line that
 * follows every tap, the rare choice under "More choices", and ONE Save that sends only what changed through the SAME three actions as the old forms (sending, then quiet hours, then reminders; each keeps its two-step-code refusal).
 * Nothing is lost: all ten settings are here. A part that did not change is never sent, and a part that was refused stays "not saved" with its own sentence.
 */
export function AutomationSimple({
  words,
  settings,
  reminders,
  actions,
  plain = false,
}: {
  /** SETTINGS_OPEN: plain labelled fields, no box around each part. */
  plain?: boolean;
  words: Readonly<Record<string, string>>;
  settings: OutboxSettings;
  reminders: SchedulerSettings | null;
  actions: AgentSettingsActions;
}) {
  const t: Say = makeT(words);
  const [base, setBase] = React.useState<AutoValues>(() =>
    fromRecord(settings, reminders),
  );
  const [v, setV] = React.useState<AutoValues>(base);
  const [isDefault, setIsDefault] = React.useState(
    reminders?.is_default ?? false,
  );
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<AgentResult[]>([]);
  const [justSaved, setJustSaved] = React.useState(false);
  const set = (patch: Partial<AutoValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setJustSaved(false);
  };

  const sendingDirty = v.auto !== base.auto || v.limit !== base.limit;
  const quietDirty =
    v.quietStart !== base.quietStart || v.quietEnd !== base.quietEnd;
  const remindersDirty =
    reminders !== null &&
    (v.evening !== base.evening ||
      v.eveningHour !== base.eveningHour ||
      v.heads !== base.heads ||
      v.headsMinutes !== base.headsMinutes ||
      v.noShow !== base.noShow ||
      v.noShowMinutes !== base.noShowMinutes);
  const dirty = sendingDirty || quietDirty || remindersDirty;

  async function run(call: () => Promise<AgentResult>): Promise<AgentResult> {
    try {
      return await call();
    } catch {
      return { ok: false, error: t("today.err.generic") };
    }
  }

  async function saveAll() {
    if (busy || !dirty) return;
    setBusy(true);
    setResults([]);
    setJustSaved(false);
    const out: AgentResult[] = [];
    let record = base;
    const failed = () => out.some((r) => !r.ok);
    // sending first, then quiet hours (the same PUT needs the sending values on record, which are the new ones once the first part is saved), then the reminders; the first refusal stops the rest
    if (sendingDirty) {
      const r = await run(() =>
        actions.saveSending({
          auto_send_enabled: v.auto,
          per_customer_daily_limit: Number(v.limit),
        }),
      );
      out.push(r);
      if (r.ok) record = { ...record, auto: v.auto, limit: v.limit };
    }
    if (quietDirty && !failed()) {
      const r = await run(() =>
        actions.saveQuietHours({
          quiet_hours_start: Number(v.quietStart),
          quiet_hours_end: Number(v.quietEnd),
          auto_send_enabled: record.auto,
          per_customer_daily_limit: Number(record.limit),
        }),
      );
      out.push(r);
      if (r.ok)
        record = { ...record, quietStart: v.quietStart, quietEnd: v.quietEnd };
    }
    if (remindersDirty && !failed()) {
      const r = await run(() =>
        actions.saveReminders({
          reminder_evening_enabled: v.evening,
          reminder_evening_hour: Number(v.eveningHour),
          reminder_heads_up_enabled: v.heads,
          reminder_heads_up_minutes: Number(v.headsMinutes),
          no_show_enabled: v.noShow,
          no_show_after_minutes: Number(v.noShowMinutes),
        }),
      );
      out.push(r);
      if (r.ok) {
        record = {
          ...record,
          evening: v.evening,
          eveningHour: v.eveningHour,
          heads: v.heads,
          headsMinutes: v.headsMinutes,
          noShow: v.noShow,
          noShowMinutes: v.noShowMinutes,
        };
        setIsDefault(false);
      }
    }
    setBase(record);
    setBusy(false);
    setResults(out);
    setJustSaved(out.length > 0 && out.every((r) => r.ok));
  }

  const fx = autoEffects(v, t);
  const clash =
    reminders !== null &&
    v.evening &&
    Number(v.eveningHour) >= Number(v.quietStart);
  const noShowLine = (
    <Sentence
      id="noshow"
      labels={{ noshow: t("auto.f.noshow") }}
      template={t("jobs.auto.line.noshow")}
      pills={{
        noshow: {
          value: v.noShow ? v.noShowMinutes : "off",
          options: choices(NO_SHOW, v.noShowMinutes),
          text: (o) =>
            o === "off"
              ? t("jobs.auto.opt.noshow.off")
              : t("jobs.auto.opt.noshow.at", { d: durText(t, Number(o)) }),
          onChange: (o) =>
            o === "off"
              ? set({ noShow: false })
              : set({ noShow: true, noShowMinutes: o }),
        },
      }}
    />
  );

  return (
    <PlainCtx.Provider value={plain}>
    <div data-part="automation" className={plain ? "flex flex-col gap-6" : "flex flex-col gap-4"}>
      <p className="m-0 text-[14px] text-muted">{t("jobs.auto.help")}</p>

      <section
        data-part="auto-sending"
        aria-labelledby="auto-sending-h"
        className={plain ? plainCard : jobsCard}
      >
        <h2 id="auto-sending-h" className={heading}>
          {t("agentset.sending.title")}
        </h2>
        <Tick
          label={t("jobs.auto.send.switch")}
          sub={t(v.auto ? "agentset.sending.on" : "agentset.sending.off")}
          checked={v.auto}
          onChange={(e) => set({ auto: e.target.checked })}
        />
        <Sentence
          id="limit"
          labels={{ limit: t("auto.f.limit") }}
          template={t("jobs.auto.line.limit")}
          pills={{
            limit: {
              value: v.limit,
              options: LIMITS,
              text: (o) => o,
              onChange: (o) => set({ limit: o }),
            },
          }}
        />
      </section>

      <section
        data-part="auto-quiet"
        aria-labelledby="auto-quiet-h"
        className={plain ? plainCard : jobsCard}
      >
        <h2 id="auto-quiet-h" className={heading}>
          {t("agentset.quiet.title")}
        </h2>
        <Sentence
          id="quiet"
          labels={{ start: t("auto.f.qstart"), end: t("auto.f.qend") }}
          template={t("jobs.auto.line.quiet")}
          pills={{
            start: {
              value: v.quietStart,
              options: QUIET_STARTS,
              text: (o) => hourText(Number(o)),
              onChange: (o) => set({ quietStart: o }),
            },
            end: {
              value: v.quietEnd,
              options: QUIET_ENDS,
              text: (o) => hourText(Number(o)),
              onChange: (o) => set({ quietEnd: o }),
            },
          }}
        />
        <p data-part="effect" aria-live="polite" className={plain ? plainFx : effectBox}>
          {plain ? null : <b>{t("jobs.auto.effect")}</b>} {fx.quiet}
        </p>
      </section>

      <section
        data-part="auto-reminders"
        aria-labelledby="auto-reminders-h"
        className={plain ? plainCard : jobsCard}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="auto-reminders-h" className={heading}>
            {t("agentset.rem.title")}
          </h2>
          {isDefault ? (
            <JobChip tone="info">{t("jobs.auto.default")}</JobChip>
          ) : null}
        </div>
        {reminders ? (
          <>
            <Sentence
              id="evening"
              labels={{ evening: t("auto.f.evening") }}
              template={t("jobs.auto.line.evening")}
              pills={{
                evening: {
                  value: v.evening ? v.eveningHour : "off",
                  options: ["off", ...EVENING],
                  text: (o) =>
                    o === "off"
                      ? t("jobs.auto.opt.evening.off")
                      : t("jobs.auto.opt.evening.at", {
                          h: hourText(Number(o)),
                        }),
                  onChange: (o) =>
                    o === "off"
                      ? set({ evening: false })
                      : set({ evening: true, eveningHour: o }),
                },
              }}
            />
            <Sentence
              id="heads"
              labels={{ heads: t("auto.f.heads") }}
              template={t("jobs.auto.line.heads")}
              pills={{
                heads: {
                  value: v.heads ? v.headsMinutes : "off",
                  options: choices(HEADS, v.headsMinutes),
                  text: (o) =>
                    o === "off"
                      ? t("jobs.auto.opt.heads.off")
                      : t("jobs.auto.opt.heads.at", {
                          d: durText(t, Number(o)),
                        }),
                  onChange: (o) =>
                    o === "off"
                      ? set({ heads: false })
                      : set({ heads: true, headsMinutes: o }),
                },
              }}
            />
            {clash ? (
              <p
                data-note="evening-inside-quiet"
                role="note"
                className="m-0 rounded-xl bg-[var(--jb-wait-soft)] px-3.5 py-2.5 text-[14px] font-medium text-ink"
              >
                {t("agentset.quiet.evening", {
                  hour: `${String(v.eveningHour).padStart(2, "0")}:00`,
                  start: `${String(v.quietStart).padStart(2, "0")}:00`,
                })}
              </p>
            ) : null}
            <p data-part="effect" aria-live="polite" className={plain ? plainFx : effectBox}>
              {plain ? null : <b>{t("jobs.auto.effect")}</b>} {fx.visits}
            </p>
          </>
        ) : (
          <p className="m-0 text-[15px] text-muted">{t("frame.notyet")}</p>
        )}
      </section>

      {reminders ? (
        <details data-part="auto-more" className={`${plain ? plainCard : jobsCard} group`}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block font-display text-[17px] font-bold leading-tight text-ink">
                {t("jobs.auto.more")}
              </span>
              <span className="block text-sm text-muted">
                {t("jobs.auto.more_sub")}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mt-2 flex flex-col">{noShowLine}</div>
        </details>
      ) : null}

      <div data-part="auto-save" className="flex flex-col gap-3">
        {results.map((r, i) =>
          r.ok ? (
            <p key={i} role="status" className={okLine}>
              {r.message}
            </p>
          ) : (
            <p key={i} role="alert" className={errorLine}>
              {r.error}
              {r.mfa ? (
                <>
                  {" "}
                  <Link
                    href="/app/security"
                    className="font-semibold underline"
                  >
                    {t("today.err.mfa.link")}
                  </Link>
                </>
              ) : null}
            </p>
          ),
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={busy || !dirty}
            className={`${primary} jb-press`}
          >
            {busy ? t("today.act.working") : t("agentset.save")}
          </button>
          {plain ? (
            <p role="status" className="m-0 text-[14px] text-muted">
              {dirty && !busy ? t("set.f.unsaved") : justSaved ? t("set.f.saved") : ""}
            </p>
          ) : (
            <>
              {dirty && !busy ? <JobChip tone="wait">{t("jobs.auto.chip.dirty")}</JobChip> : null}
              {justSaved && !dirty ? <JobChip tone="done">{t("jobs.auto.chip.saved")}</JobChip> : null}
            </>
          )}
        </div>
        <p className="m-0 text-sm text-muted">{t("agentset.mfa")}</p>
      </div>
    </div>
    </PlainCtx.Provider>
  );
}
