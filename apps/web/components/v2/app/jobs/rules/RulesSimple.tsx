"use client";

import { LAUNCH_LANGS, withKept } from "@/lib/languages";
import { fmtMinutes } from "@/lib/jobs/detail";
import { ruleEffect } from "@/lib/jobs/rules-effect";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { GOALS, RULE_SOURCES, type Channel, type Done, type Goal, type Rule, type RuleLang, type SourceTag } from "@/lib/outreach/types";

import { fieldHelp, fieldLabel, fieldTextarea, alertBox, btnMain, btnQuiet, mutedText, okBox } from "../../ui";
import { JobChip } from "../../ds/JobChip";
import { Tick } from "../../ds/Tick";
import { makeT } from "../../words";
import { buildSteps, planLines } from "../../outreach/plan-text";
import type { RulesPanelProps } from "../../outreach/RulesPanel";
import { jobCard } from "../detail/types";
import { EffectBox, MoreChoices, Choose, PillNum, RuleSwitch, Sentence, Val, withCurrent, withinText } from "./parts";

/** How soon a new lead is called: the minutes a rule may name (0 to 120). A saved value outside the list still shows and stays. */
const WITHIN = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
const DASH = "—";
const gone = (r: Pick<Rule, "unreadable">, field: string): boolean => r.unreadable?.includes(field) === true;

/**
 * Standing rules, the JOBS way (the simplicity pass): each rule is ONE plain sentence with the choice inside ("When a lead comes from [Meta lead ads], call [right away]."), a switch, and what it will do for an example lead.
 * Same reads and the same actions as the old panel: pause and resume (the switch), change (the form again, the API asks the second step), add, the goals this business type offers, the two-step code refusal and every refusal sentence.
 * Only the way it is drawn changed; a value that cannot be typed any more (minutes outside the list) is kept when the rule is changed.
 */
export function RulesSimple({ words, rules, canAdd, canControl, sourceNames, goalNames, languageNames, actions, securityHref, defaultLanguage, templates = null, retrySteps = null, templatesHref = null, goals = null, hours = null }: RulesPanelProps) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rule | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  /** What a tap on the switch shows at once, before the API answers (put back when it says no). */
  const [shown, setShown] = React.useState<Readonly<Record<string, boolean>>>({});

  const toggle = async (r: Rule, next: boolean) => {
    setBusy(r.id);
    setNote(null);
    setShown((s) => ({ ...s, [r.id]: next }));
    const out = await actions.control(r.id, next ? "resume" : "pause").catch((): Done<Rule> => ({ ok: false, error: "down" }));
    setBusy(null);
    if (out.ok) router.refresh();
    else {
      setShown((s) => ({ ...s, [r.id]: !next }));
      setNote(t(out.error === "read_only" ? "pc.err.read_only" : "ol.err.control"));
    }
  };

  const formProps = { goals, templatesHref, words, sourceNames, goalNames, languageNames, defaultLanguage, templates, retrySteps, hours, save: actions.save, securityHref };
  return (
    <div data-part="rules" data-simple="" className="flex flex-col gap-3">
      {rules.length === 0 ? <p className={`${mutedText} !mt-0`}>{t("ol.rules.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rules.map((r) => {
          const on = shown[r.id] ?? r.active;
          const source = gone(r, "source") ? DASH : (sourceNames[r.source] ?? r.source);
          const steps = r.steps ?? buildSteps(r.withinMinutes, retrySteps, r.waMissedTemplate, r.channel === "both");
          const lines = planLines(t, steps, templates);
          return (
            <li key={r.id} data-rule={r.source} data-part="rule" className={`${jobCard} jb-enter flex flex-col gap-2`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Sentence
                    line="rule"
                    template={t("jobs.rules.when")}
                    parts={{ source: () => <Val>{source}</Val>, within: () => <Val>{gone(r, "within_minutes") ? DASH : withinText(t, r.withinMinutes)}</Val> }}
                  />
                </div>
                {canControl && !gone(r, "active") ? <RuleSwitch label={t(on ? "ol.rule.pause" : "ol.rule.resume")} on={on} busy={busy === r.id} onChange={(next) => void toggle(r, next)} /> : null}
              </div>
              {!on && !gone(r, "active") ? <div><JobChip tone="wait">{r.pausedReason === "cap_calls" ? t("ol.paused.cap_calls") : r.pausedReason === "cap_minutes" ? t("ol.paused.cap_minutes") : t("ol.rule.paused")}</JobChip></div> : null}
              <p className={`${mutedText} !mt-0`}>
                <span className="block">{gone(r, "goal") ? DASH : t("jobs.rules.goal", { goal: goalNames[r.goal] ?? r.goal })}</span>
                <span className="block">{gone(r, "language") ? DASH : t("jobs.rules.lang", { language: r.language === "auto" ? t("jobs.rules.lang.auto") : (languageNames[r.language] ?? r.language) })}</span>
                {r.maxCallsPerDay ? <span className="block">{t("pc.limits.calls", { n: r.maxCallsPerDay })}</span> : null}
                {r.maxTotalMinutes ? <span className="block">{t("pc.limits.minutes", { n: r.maxTotalMinutes })}</span> : null}
              </p>
              {gone(r, "within_minutes") ? null : (
                <p data-part="rule-plan" className={`${mutedText} !mt-0`}>
                  {[lines.retry, lines.whatsapp].filter(Boolean).join(" ")}
                </p>
              )}
              <p className={`${mutedText} !mt-0`}>{gone(r, "usage") ? DASH : t("ol.rule.usage", { leads: r.usage.leads, calls: r.usage.callsToday })}</p>
              {r.warnings.includes("template_not_approved") ? (
                <p className="m-0 text-sm text-amber-text" data-part="rule-warning">
                  {t("ol.rule.tpl.warn")}
                </p>
              ) : null}
              {canControl && canAdd && !gone(r, "active") && !r.unreadable && !editing ? (
                <div>
                  <button type="button" className={btnQuiet} onClick={() => (setSaved(false), setOpen(false), setEditing(r))} data-part="rule-change">
                    {t("ol.rule.change")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {note ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {note}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className={`${okBox} !mt-0`}>
          {t("ol.rule.saved")}
        </p>
      ) : null}
      {editing ? (
        <SimpleRuleForm
          key={editing.id}
          edit={editing}
          {...formProps}
          onDone={() => {
            setEditing(null);
            setSaved(true);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {canAdd && !editing ? (
        open ? (
          <SimpleRuleForm
            {...formProps}
            onDone={() => {
              setOpen(false);
              setSaved(true);
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        ) : (
          <div>
            <button type="button" className={btnMain} onClick={() => (setSaved(false), setOpen(true))}>
              {t("ol.rule.add")}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

type FormProps = Pick<RulesPanelProps, "goals" | "templatesHref" | "words" | "sourceNames" | "goalNames" | "languageNames" | "defaultLanguage" | "templates" | "retrySteps" | "securityHref" | "hours"> & { edit?: Rule | null; save: RulesPanelProps["actions"]["save"]; onDone: () => void; onCancel: () => void };

/** The form of one rule (new or changed): the sentence first, three or four choices, what it will do, and "More choices" for the rest. Saving still asks the second step of the Owner: that is the approval. */
function SimpleRuleForm({ edit = null, goals = null, templates = null, templatesHref = null, retrySteps = null, words, sourceNames, goalNames, languageNames, defaultLanguage, save, securityHref, hours = null, onDone, onCancel }: FormProps) {
  const t = makeT(words);
  const [id] = React.useState(() => edit?.id ?? crypto.randomUUID());
  const [source, setSource] = React.useState<SourceTag>((edit?.source as SourceTag | undefined) ?? "meta_lead_ads");
  const [minutes, setMinutes] = React.useState(edit?.withinMinutes ?? 2);
  const [goal, setGoal] = React.useState<Goal>(edit?.goal ?? "general");
  // only the goals this business type offers (its pack's), and always the one a rule being changed already has
  const goalsFor: readonly Goal[] = goals ? GOALS.filter((g) => goals.includes(g) || g === edit?.goal) : GOALS;
  const [channel, setChannel] = React.useState<Channel>(edit?.channel === "both" ? "both" : "call");
  const [language, setLanguage] = React.useState<RuleLang>(edit?.language ?? "auto");
  const [questions, setQuestions] = React.useState(edit?.questions.join("\n") ?? "");
  const firstTpls = (templates ?? []).filter((x) => x.moment === "first");
  const missedTpls = (templates ?? []).filter((x) => x.moment === "missed");
  const [waFirst, setWaFirst] = React.useState<string | null>(edit?.waFirstTemplate ?? firstTpls.find((x) => x.key === "lead_ack")?.key ?? firstTpls[0]?.key ?? null);
  const [waMissed, setWaMissed] = React.useState<string | null>(edit?.waMissedTemplate ?? missedTpls.find((x) => x.key === "missed_call_followup")?.key ?? missedTpls[0]?.key ?? null);
  const [callsPerDay, setCallsPerDay] = React.useState(edit ? String(edit.maxCallsPerDay ?? "") : "50");
  const [totalMinutes, setTotalMinutes] = React.useState(edit?.maxTotalMinutes ? String(edit.maxTotalMinutes) : "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; mfa: boolean } | null>(null);
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const both = channel === "both";

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const out = await save({ ruleId: id, source, action: "call_within_minutes", withinMinutes: minutes, goal, channel, language, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), waFirstTemplate: both ? waFirst : null, waMissedTemplate: both ? waMissed : null, maxCallsPerDay: num(callsPerDay), maxTotalMinutes: num(totalMinutes) }).catch((): Done<Rule> => ({ ok: false, error: "down" }));
    setBusy(false);
    if (out.ok) onDone();
    else setError({ text: t(out.error === "not_for_schools" ? "ol.err.not_for_schools" : out.error === "mfa" ? "pc.err.mfa" : out.error === "read_only" ? "pc.err.read_only" : out.error === "state" ? "ol.rule.err.exists" : out.error === "invalid" ? "ol.new.err.invalid" : "ol.new.err.down"), mfa: out.error === "mfa" });
  };

  const sources: readonly string[] = edit && !(RULE_SOURCES as readonly string[]).includes(edit.source) ? [edit.source, ...RULE_SOURCES] : RULE_SOURCES;
  const eff = ruleEffect(minutes, both, hours);
  const lines = planLines(t, buildSteps(minutes, retrySteps, waMissed, both), templates);
  const chosenFirst = firstTpls.find((x) => x.key === waFirst) ?? null;
  const chosenMissed = missedTpls.find((x) => x.key === waMissed) ?? null;
  const tplStatus = (x: typeof chosenFirst) => (x && x.status !== "approved" ? <p className="m-0 text-sm text-amber-text" data-part="template-status">{x.status === "missing" ? t("ol.rule.tpl.st.missing", { language: words[`today.lang.${x.language}`] ?? languageNames[x.language] ?? x.language }) : t(`ol.rule.tpl.st.${x.status}`)}</p> : null);

  return (
    <form data-part="rule-form" data-simple="" onSubmit={submit} className={`${jobCard} flex flex-col gap-3`}>
      <h3 className="m-0 font-display text-[17px] font-bold leading-tight text-ink">{t(edit ? "ol.rule.change.title" : "ol.rule.new")}</h3>
      <div data-part="rule-sentence" className="flex flex-col">
        <Sentence
          line="when"
          template={t("jobs.rules.when")}
          parts={{
            source: (aria) => <Choose aria={aria} value={source} options={sources} disabled={edit !== null} text={(v) => sourceNames[v] ?? v} onChange={(v) => setSource(v as SourceTag)} />,
            within: (aria) => <Choose aria={`${aria} (2)`} value={String(minutes)} options={withCurrent(WITHIN, minutes).map(String)} text={(v) => withinText(t, Number(v))} onChange={(v) => setMinutes(Number(v))} />,
          }}
        />
        <Sentence line="goal" template={t("jobs.rules.goal")} parts={{ goal: (aria) => <Choose aria={aria} value={goal} options={goalsFor} text={(v) => goalNames[v] ?? v} onChange={(v) => setGoal(v as Goal)} /> }} />
      </div>
      <Tick data-part="rule-wa" label={t("jobs.rules.wa_tick")} checked={both} onChange={(e) => setChannel(e.target.checked ? "both" : "call")} />
      <EffectBox
        label={t("jobs.rules.effect")}
        text={
          eff.code === "wa_call"
            ? t("jobs.rules.effect.wa_call", { who: t("jobs.rules.who"), t1: fmtMinutes(eff.at), t2: fmtMinutes(eff.wa ?? eff.call), t3: fmtMinutes(eff.call) })
            : t("jobs.rules.effect.call", { who: t("jobs.rules.who"), t1: fmtMinutes(eff.at), t2: fmtMinutes(eff.call) })
        }
      />
      <p data-part="rule-plan" className={`${mutedText} !mt-0`}>
        {[lines.retry, lines.whatsapp].filter(Boolean).join(" ")}
      </p>
      <MoreChoices title={t("jobs.rules.more")} sub={t("jobs.rules.more_sub")}>
        <Sentence
          line="lang"
          template={t("jobs.rules.lang")}
          parts={{
            language: (aria) => (
              <Choose
                aria={aria}
                value={language}
                options={["auto", ...withKept(LAUNCH_LANGS, language === "auto" ? defaultLanguage : language)]}
                text={(v) => (v === "auto" ? t("jobs.rules.lang.auto") : (languageNames[v] ?? v))}
                onChange={(v) => setLanguage(v as RuleLang)}
              />
            ),
          }}
        />
        {both ? (
          <div data-part="rule-templates" className="flex flex-col gap-1">
            {firstTpls.length > 0 && templates !== null ? (
              <Sentence line="tpl-first" template={t("jobs.rules.tpl_first")} parts={{ msg: (aria) => <Choose aria={aria} value={waFirst ?? ""} options={firstTpls.map((x) => x.key)} text={(v) => firstTpls.find((x) => x.key === v)?.label ?? v} onChange={(v) => setWaFirst(v)} /> }} />
            ) : (
              <p className={`${fieldHelp} !mt-0`} data-part="rule-template">{t("ol.rule.tpl.none")}</p>
            )}
            {chosenFirst ? <p className="m-0 rounded-lg border border-line bg-surface-2 p-3 text-[15px]" data-part="template-preview">{chosenFirst.preview}</p> : null}
            {tplStatus(chosenFirst)}
            {missedTpls.length > 0 && templates !== null ? (
              <Sentence line="tpl-missed" template={t("jobs.rules.tpl_missed")} parts={{ msg: (aria) => <Choose aria={aria} value={waMissed ?? ""} options={missedTpls.map((x) => x.key)} text={(v) => missedTpls.find((x) => x.key === v)?.label ?? v} onChange={(v) => setWaMissed(v)} /> }} />
            ) : null}
            {chosenMissed ? <p className="m-0 rounded-lg border border-line bg-surface-2 p-3 text-[15px]" data-part="template-preview">{chosenMissed.preview}</p> : null}
            {tplStatus(chosenMissed)}
            {templatesHref ? (
              <p className="m-0" data-part="manage-templates">
                <Link href={templatesHref} className="text-sm font-semibold text-brand-text underline underline-offset-4">
                  {t("ol.rule.tpl.manage")}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        <div>
          <label htmlFor="rf-q" className={fieldLabel}>
            {t("ol.new.questions")}
          </label>
          <textarea id="rf-q" className={fieldTextarea} rows={3} value={questions} onChange={(e) => setQuestions(e.target.value)} />
          <p className={fieldHelp}>{t("ol.new.questions.help")}</p>
        </div>
        <Sentence line="cap-calls" template={t("jobs.rules.cap_calls")} parts={{ n: (aria) => <PillNum aria={aria} min={1} value={callsPerDay} placeholder={t("jobs.rules.nolimit")} onChange={setCallsPerDay} /> }} />
        <Sentence line="cap-min" template={t("jobs.rules.cap_min")} parts={{ n: (aria) => <PillNum aria={aria} min={1} value={totalMinutes} placeholder={t("jobs.rules.nolimit")} onChange={setTotalMinutes} /> }} />
      </MoreChoices>
      <p className={`${fieldHelp} !mt-0`}>{t("ol.rule.approve.help")}</p>
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {error.text}{" "}
          {error.mfa ? (
            <Link href={securityHref} className="font-semibold underline">
              {t("pc.err.mfa.link")}
            </Link>
          ) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={btnMain} disabled={busy}>
          {busy ? t("pc.approving") : t("ol.rule.approve")}
        </button>
        <button type="button" className={btnQuiet} onClick={onCancel}>
          {t("ol.rule.cancel")}
        </button>
      </div>
    </form>
  );
}
