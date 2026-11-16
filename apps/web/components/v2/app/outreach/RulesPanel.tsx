"use client";

import { LAUNCH_LANGS, withKept } from "@/lib/languages";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { GOALS, RULE_CHANNELS, RULE_SOURCES, type RetryStep, type RuleLang, type RuleTemplate, type CallLang, type Channel, type Done, type Goal, type Rule, type RuleAction, type SourceTag } from "@/lib/outreach/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, formStack, mutedText, okBox, pillAmber, pillGreen, surface } from "../ui";
import { makeT, type Words } from "../words";

import { buildSteps, callPhrase, planLines } from "./plan-text";

/**
 * Standing rules per lead source (night 4, part A3): "Call new leads within 2 minutes in calling hours", approved ONCE by the Owner (second factor); after that nobody clicks per lead. Each rule can be paused and shows what it did.
 * The Owner adds a rule; the Owner and Admin pause and resume; the others read. The words of a rule are always one plain sentence, so the owner reads exactly what was approved.
 */
export type RuleActions = { save: (input: unknown) => Promise<Done<Rule>>; control: (ruleId: string, action: "pause" | "resume") => Promise<Done<Rule>> };

/** What a value the list could not read shows as (parseRuleRow names those values; the rest of the row and the list still show). */
const DASH = "—";
const gone = (r: Pick<Rule, "unreadable">, field: string): boolean => r.unreadable?.includes(field) === true;

export function RulesPanel({ words, rules, canAdd, canControl, sourceNames, goalNames, languageNames, actions, securityHref, defaultLanguage, templates = null, retrySteps = null }: { /** The WhatsApp messages a rule may name (an approved template per moment), or null = the list could not be read. */ templates?: readonly RuleTemplate[] | null; /** The policy's retry steps (10 minutes, 2 hours, next morning), or null = not sent. */ retrySteps?: readonly RetryStep[] | null; words: Words; rules: readonly Rule[]; canAdd: boolean; canControl: boolean; sourceNames: Readonly<Record<string, string>>; goalNames: Readonly<Record<string, string>>; languageNames: Readonly<Record<string, string>>; actions: RuleActions; securityHref: string; defaultLanguage: CallLang }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  /** The rule being changed (its own form, the same rule id: the API then updates it in place and asks the second step again), or null. */
  const [editing, setEditing] = React.useState<Rule | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // call first (owner, 5 Nov): every rule calls; "both" adds WhatsApp only when the customer asks for it on the call
  // 0 is "immediately" and 1 is "1 minute", never "1 minutes" (owner, 15 Nov)
  const sentence = (r: Pick<Rule, "source" | "withinMinutes" | "channel"> & { unreadable?: readonly string[] }): string => {
    if (r.unreadable?.some((f) => f === "source" || f === "within_minutes")) return DASH;
    const base = r.channel === "call" ? "ol.rule.sentence.call_within_minutes" : "ol.rule.sentence.call_then_ask";
    const key = r.withinMinutes === 0 ? `${base}_now` : r.withinMinutes === 1 ? `${base}_one` : base;
    return t(key as "ol.rule.sentence.call_within_minutes", { source: sourceNames[r.source] ?? r.source, n: r.withinMinutes });
  };

  const toggle = async (r: Rule) => {
    setBusy(r.id);
    setNote(null);
    const out = await actions.control(r.id, r.active ? "pause" : "resume").catch((): Done<Rule> => ({ ok: false, error: "down" }));
    setBusy(null);
    if (out.ok) router.refresh();
    else setNote(t(out.error === "read_only" ? "pc.err.read_only" : "ol.err.control"));
  };

  return (
    <div data-part="rules" className="flex flex-col gap-3">
      {rules.length === 0 ? <p className={`${mutedText} !mt-0`}>{t("ol.rules.none")}</p> : null}
      <ul className="flex flex-col gap-3">
        {rules.map((r) => (
          <li key={r.id} data-rule={r.source} className={`${surface} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words font-display text-lg font-bold">{sentence(r)}</p>
              <span className={r.active ? pillGreen : pillAmber}>{gone(r, "active") ? DASH : r.active ? t("ol.rule.on") : r.pausedReason === "cap_calls" ? t("ol.paused.cap_calls") : r.pausedReason === "cap_minutes" ? t("ol.paused.cap_minutes") : t("ol.rule.paused")}</span>
            </div>
            <p className={`${mutedText} !mt-0`}>
              {gone(r, "goal") ? DASH : (goalNames[r.goal] ?? r.goal)} · {gone(r, "channel") ? DASH : t(r.channel === "call" ? "ol.rule.channel.call" : "ol.rule.channel.both")} · {gone(r, "language") ? DASH : r.language === "auto" ? t("ol.rule.lang.auto") : (languageNames[r.language] ?? r.language)}
              {r.maxCallsPerDay ? ` · ${t("pc.limits.calls", { n: r.maxCallsPerDay })}` : ""}
              {r.maxTotalMinutes ? ` · ${t("pc.limits.minutes", { n: r.maxTotalMinutes })}` : ""}
            </p>
            <p className={`${mutedText} !mt-0`}>{gone(r, "usage") ? DASH : t("ol.rule.usage", { leads: r.usage.leads, calls: r.usage.callsToday })}</p>
            <RulePlan t={t} steps={r.steps ?? buildSteps(r.withinMinutes, retrySteps, r.waMissedTemplate, r.channel === "both")} templates={templates} show={!gone(r, "within_minutes")} skipCall />
            {r.warnings.includes("template_not_approved") ? <p className={`${mutedText} !mt-0`} data-part="rule-warning">{t("ol.rule.tpl.warn")}</p> : null}
            {canControl && !gone(r, "active") ? (
              <div>
                <button type="button" className={btnQuiet} disabled={busy === r.id} onClick={() => void toggle(r)}>
                  {r.active ? t("ol.rule.pause") : t("ol.rule.resume")}
                </button>
                {canAdd && !r.unreadable && !editing ? (
                  <button type="button" className={`${btnQuiet} ml-2`} onClick={() => (setSaved(false), setOpen(false), setEditing(r))} data-part="rule-change">
                    {t("ol.rule.change")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
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
        <RuleForm
          key={editing.id}
          edit={editing}
          words={words}
          sourceNames={sourceNames}
          goalNames={goalNames}
          languageNames={languageNames}
          defaultLanguage={defaultLanguage}
          templates={templates}
          retrySteps={retrySteps}
          sentence={sentence}
          save={actions.save}
          securityHref={securityHref}
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
          <RuleForm
            words={words}
            sourceNames={sourceNames}
            goalNames={goalNames}
            languageNames={languageNames}
            defaultLanguage={defaultLanguage}
            templates={templates}
            retrySteps={retrySteps}
            sentence={sentence}
            save={actions.save}
            securityHref={securityHref}
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

function RuleForm({ edit = null, templates, retrySteps, words, sourceNames, goalNames, languageNames, defaultLanguage, sentence, save, securityHref, onDone, onCancel }: { templates: readonly RuleTemplate[] | null; retrySteps: readonly RetryStep[] | null; /** A rule being changed: its values fill the form, its id is kept (the API updates it in place) and its source stays. */ edit?: Rule | null; words: Words; sourceNames: Readonly<Record<string, string>>; goalNames: Readonly<Record<string, string>>; languageNames: Readonly<Record<string, string>>; defaultLanguage: CallLang; sentence: (r: { source: string; withinMinutes: number; channel: Channel }) => string; save: RuleActions["save"]; securityHref: string; onDone: () => void; onCancel: () => void }) {
  const t = makeT(words);
  const [id] = React.useState(() => edit?.id ?? crypto.randomUUID());
  const [source, setSource] = React.useState<SourceTag>((edit?.source as SourceTag | undefined) ?? "meta_lead_ads");
  const action: RuleAction = "call_within_minutes";
  const [minutes, setMinutes] = React.useState(edit?.withinMinutes ?? 2);
  const [goal, setGoal] = React.useState<Goal>(edit?.goal ?? "general");
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

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const out = await save({ ruleId: id, source, action, withinMinutes: minutes, goal, channel, language, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), waFirstTemplate: channel === "both" ? waFirst : null, waMissedTemplate: channel === "both" ? waMissed : null, maxCallsPerDay: num(callsPerDay), maxTotalMinutes: num(totalMinutes) }).catch((): Done<Rule> => ({ ok: false, error: "down" }));
    setBusy(false);
    if (out.ok) onDone();
    else setError({ text: t(out.error === "not_for_schools" ? "ol.err.not_for_schools" : out.error === "mfa" ? "pc.err.mfa" : out.error === "read_only" ? "pc.err.read_only" : out.error === "state" ? "ol.rule.err.exists" : out.error === "invalid" ? "ol.new.err.invalid" : "ol.new.err.down"), mfa: out.error === "mfa" });
  };

  return (
    <form data-part="rule-form" onSubmit={submit} className={`${surface} ${formStack}`}>
      <h3 className="font-display text-lg font-bold">{t(edit ? "ol.rule.change.title" : "ol.rule.new")}</h3>
      <div>
        <label htmlFor="rf-source" className={fieldLabel}>
          {t("ol.rule.source")}
        </label>
        <select id="rf-source" className={fieldInput} value={source} disabled={edit !== null} onChange={(e) => setSource(e.target.value as SourceTag)}>
          {RULE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceNames[s] ?? s}
            </option>
          ))}
        </select>
      </div>
      {/* call first (owner, 5 Nov): a new lead is always called; there is no WhatsApp-first rule to choose */}
      <div>
        <p className={fieldLabel}>{t("ol.rule.action")}</p>
        <p className="text-base" data-part="rule-action">{callPhrase(t, minutes)}</p>
        <RulePlan t={t} steps={buildSteps(minutes, retrySteps, waMissed, channel === "both")} templates={templates} show skipCall />
      </div>
      <div>
        <label htmlFor="rf-min" className={fieldLabel}>
          {t("ol.rule.within")}
        </label>
        <input id="rf-min" type="number" inputMode="numeric" min={0} max={120} className={`${fieldInput} max-w-40`} value={minutes} onChange={(e) => setMinutes(Math.min(120, Math.max(0, Math.trunc(Number(e.target.value)) || 0)))} />
        <p className={fieldHelp}>{t(minutes === 0 ? "ol.rule.within.now" : "ol.rule.within.help")}</p>
      </div>
      <div>
        <label htmlFor="rf-goal" className={fieldLabel}>
          {t("pc.goal")}
        </label>
        <select id="rf-goal" className={fieldInput} value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {goalNames[g] ?? g}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={fieldLabel}>{t("pc.channel")}</legend>
        {RULE_CHANNELS.map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-3 text-base">
            <input type="radio" name="rf-channel" className="size-5 accent-brand-text" checked={channel === c} onChange={() => setChannel(c)} />
            {t(c === "call" ? "ol.rule.channel.call" : "ol.rule.channel.both")}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="rf-lang" className={fieldLabel}>
          {t("ol.new.language")}
        </label>
        <select id="rf-lang" className={fieldInput} value={language} onChange={(e) => setLanguage(e.target.value as RuleLang)}>
          <option value="auto">{t("ol.rule.lang.auto")}</option>
          {withKept(LAUNCH_LANGS, language === "auto" ? defaultLanguage : language).map((l) => (
            <option key={l} value={l}>
              {languageNames[l] ?? l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rf-q" className={fieldLabel}>
          {t("ol.new.questions")}
        </label>
        <textarea id="rf-q" className={fieldTextarea} rows={3} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        <p className={fieldHelp}>{t("ol.new.questions.help")}</p>
      </div>
      {channel === "both" && (
          <>
          <TemplatePick t={t} id="rf-tpl-first" label={t("ol.rule.tpl.first")} help={t("ol.rule.tpl.first.help")} items={firstTpls} value={waFirst} onChange={setWaFirst} unavailable={templates === null} />
        <TemplatePick t={t} id="rf-tpl-missed" label={t("ol.rule.tpl.missed")} help={t("ol.rule.tpl.missed.help")} items={missedTpls} value={waMissed} onChange={setWaMissed} unavailable={templates === null} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rf-cpd" className={fieldLabel}>
            {t("ol.new.callsperday")}
          </label>
          <input id="rf-cpd" type="number" inputMode="numeric" min={1} className={fieldInput} value={callsPerDay} onChange={(e) => setCallsPerDay(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rf-tm" className={fieldLabel}>
            {t("ol.new.totalminutes")}
          </label>
          <input id="rf-tm" type="number" inputMode="numeric" min={1} className={fieldInput} value={totalMinutes} onChange={(e) => setTotalMinutes(e.target.value)} />
        </div>
      </div>
      <p data-part="rule-sentence" className="rounded-lg border border-line bg-surface-2 p-3 text-base font-semibold">
        {sentence({ source, withinMinutes: minutes, channel })}
      </p>
      <p className={fieldHelp}>{t("ol.rule.approve.help")}</p>
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

/** The retries and the WhatsApp step of a rule, as plain lines (the call line is the form's own "What happens to a new lead"). */
function RulePlan({ t, steps, templates, show, skipCall = false }: { t: ReturnType<typeof makeT>; steps: Parameters<typeof planLines>[1]; templates: readonly RuleTemplate[] | null; show: boolean; skipCall?: boolean }) {
  if (!show) return null;
  const lines = planLines(t, steps, templates);
  return (
    <ul data-part="rule-plan" className={`${mutedText} !mt-0 flex list-none flex-col gap-1 p-0`}>
      {skipCall ? null : <li>{lines.call}</li>}
      {lines.retry ? <li>{lines.retry}</li> : null}
      {lines.whatsapp ? <li>{lines.whatsapp}</li> : null}
    </ul>
  );
}

/** One WhatsApp message of a rule: a pick from the approved templates, with its preview and a warning when WhatsApp has not approved it yet. Nothing is typed here: WhatsApp only takes approved templates after a call. */
function TemplatePick({ t, id, label, help, items, value, onChange, unavailable }: { t: ReturnType<typeof makeT>; id: string; label: string; help: string; items: readonly RuleTemplate[]; value: string | null; onChange: (key: string | null) => void; unavailable: boolean }) {
  const chosen = items.find((x) => x.key === value) ?? null;
  return (
    <div data-part="rule-template">
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      {unavailable || items.length === 0 ? (
        <p className={`${fieldHelp} !mt-0`}>{t("ol.rule.tpl.none")}</p>
      ) : (
        <select id={id} className={fieldInput} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
          {items.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      )}
      {chosen ? <p className="mt-2 rounded-lg border border-line bg-surface-2 p-3 text-base" data-part="template-preview">{chosen.preview}</p> : null}
      {chosen && chosen.status !== "approved" ? <p className={`${fieldHelp} text-amber-text`} data-part="template-status">{t(`ol.rule.tpl.st.${chosen.status}`)}</p> : null}
      <p className={fieldHelp}>{help}</p>
    </div>
  );
}
