"use client";

import type { ReactNode } from "react";

import { fmtHhmm } from "@/lib/jobs/detail";
import type { AssistantProfile } from "@/lib/assistant/defaults";
import { DAYS, HOURS, NAME_MAX, type AssistantSettings as Settings, type CallLang, type Day } from "@/lib/assistant/types";
import { withKept } from "@/lib/languages";

import { Tick } from "../ds/Tick";
import { Choose, EffectBox, MoreChoices, PillNum, Sentence } from "../jobs/rules/parts";
import { JbCard, PillField } from "../settings/simple-b";
import { jbHelp } from "../settings/simple-b-styles";
import type { Say } from "../words";

/** The calling hours the API takes: 10:00 to 21:00 in steps of 15 minutes. */
const HOUR_OPTIONS: readonly string[] = (() => {
  const out: string[] = [];
  for (let m = 10 * 60; m <= 21 * 60; m += HOURS.stepMinutes) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
})();

const dayChip = (on: boolean) => `min-h-11 rounded-md border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

type Common = { t: Say; s: Settings; set: (p: Partial<Settings>) => void; disabled: boolean };

/**
 * Settings > Your assistant > Basics under JOBS (the simplicity pass): the name and the language as two sentences with the choice inside, the one tick that matters (switch to the customer's language), "What it will do:" and the rare tick under "More choices".
 * It edits the SAME fields as the form of before (name, lang, autoSwitch, mixEnglish) and the page saves them through the same action; the voice and the preview stay where they were.
 */
export function SimpleBasics({ t, s, set, disabled, offered, langs, shop, shownName, unnamed, nameBlank, nameOk, saved, defaultName }: Common & { offered: readonly CallLang[]; langs: Record<CallLang, string>; shop: string; shownName: string; /** no name of its own yet: the line says it is the AI assistant of the business */ unnamed: boolean; nameBlank: boolean; nameOk: boolean; saved: boolean; defaultName: string }): ReactNode {
  const fx = `${t(unnamed ? "jobs.set.b.asst.fx.noname" : "jobs.set.b.asst.fx", { name: shownName, shop, lang: langs[s.lang] })}${s.autoSwitch ? ` ${t("jobs.set.b.asst.fx.switch")}` : ""}`;
  return (
    <>
      <JbCard id="asst-name-h" title={t("jobs.set.b.asst.you")} part="asst-simple-basics">
        <Sentence
          line="name"
          template={t("jobs.set.b.asst.name.line")}
          parts={{ name: () => <PillField aria={t("asst.name.label")} id="asst-name" value={s.name} maxLength={NAME_MAX} placeholder={defaultName} disabled={disabled} aria-invalid={!nameOk && !nameBlank} aria-describedby={nameOk ? undefined : "asst-name-err"} onChange={(e) => set({ name: e.target.value })} /> }}
        />
        {nameBlank && !saved ? (
          <p id="asst-name-err" className={jbHelp}>
            {t("asst.name.need")}
          </p>
        ) : nameOk ? null : (
          <p id="asst-name-err" role="alert" className="m-0 text-sm font-medium text-red-text">
            {t("asst.name.err", { n: NAME_MAX })}
          </p>
        )}
        <Sentence
          line="lang"
          template={t("jobs.set.b.asst.lang.line")}
          parts={{ lang: (aria) => <Choose aria={aria} value={s.lang} options={withKept(offered, s.lang)} text={(l) => langs[l as CallLang]} disabled={disabled} onChange={(l) => set({ lang: l as CallLang })} /> }}
        />
        <Tick label={t("asst.lang.auto")} checked={s.autoSwitch} disabled={disabled} onChange={(e) => set({ autoSwitch: e.target.checked })} />
        <EffectBox label={t("jobs.set.b.effect")} text={fx} />
        <MoreChoices title={t("jobs.set.b.more")} sub={t("jobs.set.b.asst.more_basics")}>
          <Tick label={t("asst.lang.mix")} checked={s.mixEnglish} disabled={disabled} onChange={(e) => set({ mixEnglish: e.target.checked })} />
        </MoreChoices>
      </JbCard>
    </>
  );
}

/** "It can answer prices, book visits and send WhatsApp." from what is ticked right now (the effect line follows every tap). */
function mayText(t: Say, s: Settings, rows: AssistantProfile["mayRows"]): string {
  const list = rows.filter((k) => s.may[k]).map((k) => t(`jobs.set.b.asst.fx.may.${k}`));
  return list.length === 0 ? t("jobs.set.b.asst.fx.none") : t("jobs.set.b.asst.fx.can", { list: list.join(", ") });
}

/**
 * Settings > Your assistant > Behaviour under JOBS: what it may do on its own (ticks, and the discount as a number inside its sentence), when it passes to you (two ticks) and, under "More choices", the order limit, dues and the calling hours.
 * The same fields as the form of before (may, maxDiscount, handover, hours): the page saves them through the same action, the same limits apply (hours 09:00 to 21:00 in 15 minutes, a discount from 0 to 50, at least one day).
 */
export function SimpleBehaviour({ t, s, set, disabled, profile, hoursOk, rangeOk }: Common & { profile: AssistantProfile; hoursOk: boolean; rangeOk: boolean }): ReactNode {
  const rows = profile.mayRows.filter((k) => k !== "dues");
  const toggleDay = (d: Day) => set({ hours: { ...s.hours, days: s.hours.days.includes(d) ? s.hours.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || s.hours.days.includes(x)) } });
  const effect = [mayText(t, s, profile.mayRows), profile.discount ? (s.maxDiscount === 0 ? t("jobs.set.b.asst.fx.disc0") : t("jobs.set.b.asst.fx.disc", { n: s.maxDiscount })) : null].filter(Boolean).join(" ");
  const reasons = [s.handover.owner ? t("jobs.set.b.asst.fx.hand.owner") : null, s.handover.upset ? t("jobs.set.b.asst.fx.hand.upset") : null, profile.orderLimit && s.handover.orderAbove !== null ? t("jobs.set.b.asst.fx.hand.above", { n: s.handover.orderAbove }) : null].filter((x): x is string => x !== null);
  const hand = reasons.length === 0 ? t("jobs.set.b.asst.fx.hand.never") : reasons.join(" ");
  return (
    <>
      <JbCard id="asst-may-h" title={t("asst.may.t")} part="asst-simple-may">
        {rows.map((k) => (
          <Tick key={k} label={t(`asst.may.${k}` as "asst.may.prices")} checked={s.may[k]} disabled={disabled} onChange={(e) => set({ may: { ...s.may, [k]: e.target.checked } })} />
        ))}
        {profile.discount ? (
          <>
            <Sentence
              line="discount"
              template={t("jobs.set.b.asst.discount.line")}
              parts={{ n: (aria) => <PillNum aria={aria} value={String(s.maxDiscount)} min={0} max={50} disabled={disabled} onChange={(v) => set({ maxDiscount: Math.max(0, Math.min(50, Math.trunc(Number(v) || 0))) })} /> }}
            />
            <p className={jbHelp}>{t("asst.discount.help")}</p>
          </>
        ) : null}
        <EffectBox label={t("jobs.set.b.effect")} text={effect} />
      </JbCard>

      <JbCard id="asst-hand-h" title={t("asst.handover.t")} part="asst-simple-hand">
        <p className={jbHelp}>{t("asst.handover.d")}</p>
        <Tick label={t("asst.handover.owner")} checked={s.handover.owner} disabled={disabled} onChange={(e) => set({ handover: { ...s.handover, owner: e.target.checked } })} />
        <Tick label={t("asst.handover.upset")} checked={s.handover.upset} disabled={disabled} onChange={(e) => set({ handover: { ...s.handover, upset: e.target.checked } })} />
        <EffectBox label={t("jobs.set.b.effect")} text={hand} />
        <MoreChoices title={t("jobs.set.b.more")} sub={t("jobs.set.b.asst.more_behaviour")}>
          {profile.mayRows.includes("dues") ? <Tick label={t("asst.may.dues")} checked={s.may.dues} disabled={disabled} onChange={(e) => set({ may: { ...s.may, dues: e.target.checked } })} /> : null}
          {profile.orderLimit ? (
            <>
              <Sentence
                line="above"
                template={t("jobs.set.b.asst.above.line")}
                parts={{ n: (aria) => <PillNum aria={aria} value={s.handover.orderAbove === null ? "" : String(s.handover.orderAbove)} min={0} placeholder={t("jobs.set.b.asst.above.none")} disabled={disabled} onChange={(v) => set({ handover: { ...s.handover, orderAbove: v === "" ? null : Math.max(0, Math.trunc(Number(v) || 0)) } })} /> }}
              />
              <p className={jbHelp}>{t("asst.handover.above.help")}</p>
            </>
          ) : null}
          <Sentence
            line="hours"
            template={t("jobs.set.b.asst.hours.line")}
            parts={{
              from: (aria) => <Choose aria={`${aria} (1)`} value={s.hours.from} options={HOUR_OPTIONS} text={fmtHhmm} disabled={disabled} onChange={(v) => set({ hours: { ...s.hours, from: v } })} />,
              to: (aria) => <Choose aria={`${aria} (2)`} value={s.hours.to} options={HOUR_OPTIONS} text={fmtHhmm} disabled={disabled} onChange={(v) => set({ hours: { ...s.hours, to: v } })} />,
            }}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("asst.hours.t")}>
            {DAYS.map((d) => (
              <button key={d} type="button" aria-pressed={s.hours.days.includes(d)} disabled={disabled} onClick={() => toggleDay(d)} className={dayChip(s.hours.days.includes(d))}>
                {t(`asst.day.${d}` as "asst.day.mon")}
              </button>
            ))}
          </div>
          {hoursOk ? null : (
            <p role="alert" className="m-0 text-sm font-medium text-red-text">
              {t("asst.hours.err")}
            </p>
          )}
          {rangeOk ? null : (
            <p role="alert" className="m-0 text-sm font-medium text-red-text">
              {t("asst.hours.range")}
            </p>
          )}
        </MoreChoices>
      </JbCard>
    </>
  );
}
