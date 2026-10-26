"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS, CHANNELS, GOALS, RULE_ACTIONS, RULE_SOURCES, type CallLang, type Channel, type Done, type Goal, type Rule, type RuleAction, type SourceTag } from "@/lib/outreach/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, formStack, mutedText, okBox, pillAmber, pillGreen, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Standing rules per lead source (night 4, part A3): "Call new leads within 2 minutes in calling hours", approved ONCE by the Owner (second factor); after that nobody clicks per lead. Each rule can be paused and shows what it did.
 * The Owner adds a rule; the Owner and Admin pause and resume; the others read. The words of a rule are always one plain sentence, so the owner reads exactly what was approved.
 */
export type RuleActions = { save: (input: unknown) => Promise<Done<Rule>>; control: (ruleId: string, action: "pause" | "resume") => Promise<Done<Rule>> };

export function RulesPanel({ words, rules, canAdd, canControl, sourceNames, goalNames, languageNames, actions, securityHref, defaultLanguage }: { words: Words; rules: readonly Rule[]; canAdd: boolean; canControl: boolean; sourceNames: Readonly<Record<string, string>>; goalNames: Readonly<Record<string, string>>; languageNames: Readonly<Record<string, string>>; actions: RuleActions; securityHref: string; defaultLanguage: CallLang }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const sentence = (r: Pick<Rule, "source" | "action" | "withinMinutes">): string =>
    t(`ol.rule.sentence.${r.action}` as "ol.rule.sentence.call_within_minutes", { source: sourceNames[r.source] ?? r.source, n: r.withinMinutes });

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
              <span className={r.active ? pillGreen : pillAmber}>{r.active ? t("ol.rule.on") : r.pausedReason === "cap_calls" ? t("ol.paused.cap_calls") : r.pausedReason === "cap_minutes" ? t("ol.paused.cap_minutes") : t("ol.rule.paused")}</span>
            </div>
            <p className={`${mutedText} !mt-0`}>
              {goalNames[r.goal] ?? r.goal} · {t(`pc.channel.${r.channel}` as "pc.channel.call")} · {languageNames[r.language] ?? r.language}
              {r.maxCallsPerDay ? ` · ${t("pc.limits.calls", { n: r.maxCallsPerDay })}` : ""}
              {r.maxTotalMinutes ? ` · ${t("pc.limits.minutes", { n: r.maxTotalMinutes })}` : ""}
            </p>
            <p className={`${mutedText} !mt-0`}>{t("ol.rule.usage", { leads: r.usage.leads, calls: r.usage.callsToday })}</p>
            {canControl ? (
              <div>
                <button type="button" className={btnQuiet} disabled={busy === r.id} onClick={() => void toggle(r)}>
                  {r.active ? t("ol.rule.pause") : t("ol.rule.resume")}
                </button>
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
      {canAdd ? (
        open ? (
          <RuleForm
            words={words}
            sourceNames={sourceNames}
            goalNames={goalNames}
            languageNames={languageNames}
            defaultLanguage={defaultLanguage}
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

function RuleForm({ words, sourceNames, goalNames, languageNames, defaultLanguage, sentence, save, securityHref, onDone, onCancel }: { words: Words; sourceNames: Readonly<Record<string, string>>; goalNames: Readonly<Record<string, string>>; languageNames: Readonly<Record<string, string>>; defaultLanguage: CallLang; sentence: (r: { source: string; action: RuleAction; withinMinutes: number }) => string; save: RuleActions["save"]; securityHref: string; onDone: () => void; onCancel: () => void }) {
  const t = makeT(words);
  const [id] = React.useState(() => crypto.randomUUID());
  const [source, setSource] = React.useState<SourceTag>("meta_lead_ads");
  const [action, setAction] = React.useState<RuleAction>("call_within_minutes");
  const [minutes, setMinutes] = React.useState(2);
  const [goal, setGoal] = React.useState<Goal>("general");
  const [channel, setChannel] = React.useState<Channel>("call");
  const [language, setLanguage] = React.useState<CallLang>(defaultLanguage);
  const [questions, setQuestions] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [callsPerDay, setCallsPerDay] = React.useState("50");
  const [totalMinutes, setTotalMinutes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; mfa: boolean } | null>(null);
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const needsMessage = action !== "call_within_minutes" || channel !== "call";

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const out = await save({ ruleId: id, source, action, withinMinutes: minutes, goal, channel, language, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), messageText: needsMessage ? message : null, maxCallsPerDay: num(callsPerDay), maxTotalMinutes: num(totalMinutes) }).catch((): Done<Rule> => ({ ok: false, error: "down" }));
    setBusy(false);
    if (out.ok) onDone();
    else setError({ text: t(out.error === "mfa" ? "pc.err.mfa" : out.error === "read_only" ? "pc.err.read_only" : out.error === "state" ? "ol.rule.err.exists" : out.error === "invalid" ? "ol.new.err.invalid" : "ol.new.err.down"), mfa: out.error === "mfa" });
  };

  return (
    <form data-part="rule-form" onSubmit={submit} className={`${surface} ${formStack}`}>
      <h3 className="font-display text-lg font-bold">{t("ol.rule.new")}</h3>
      <div>
        <label htmlFor="rf-source" className={fieldLabel}>
          {t("ol.rule.source")}
        </label>
        <select id="rf-source" className={fieldInput} value={source} onChange={(e) => setSource(e.target.value as SourceTag)}>
          {RULE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceNames[s] ?? s}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={fieldLabel}>{t("ol.rule.action")}</legend>
        {RULE_ACTIONS.map((a) => (
          <label key={a} className="flex min-h-11 items-center gap-3 text-base">
            <input type="radio" name="rf-action" className="size-5 accent-brand-text" checked={action === a} onChange={() => (setAction(a), a !== "call_within_minutes" && setChannel("both"))} />
            {t(`ol.rule.action.${a}` as "ol.rule.action.call_within_minutes")}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="rf-min" className={fieldLabel}>
          {t("ol.rule.within")}
        </label>
        <input id="rf-min" type="number" inputMode="numeric" min={1} max={120} className={`${fieldInput} max-w-40`} value={minutes} onChange={(e) => setMinutes(Math.min(120, Math.max(1, Number(e.target.value) || 1)))} />
        <p className={fieldHelp}>{t("ol.rule.within.help")}</p>
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
        {CHANNELS.map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-3 text-base">
            <input type="radio" name="rf-channel" className="size-5 accent-brand-text" checked={channel === c} onChange={() => setChannel(c)} />
            {t(`pc.channel.${c}` as "pc.channel.call")}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="rf-lang" className={fieldLabel}>
          {t("ol.new.language")}
        </label>
        <select id="rf-lang" className={fieldInput} value={language} onChange={(e) => setLanguage(e.target.value as CallLang)}>
          {CALL_LANGS.map((l) => (
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
      {needsMessage ? (
        <div>
          <label htmlFor="rf-m" className={fieldLabel}>
            {t("ol.new.message")}
          </label>
          <textarea id="rf-m" className={fieldTextarea} rows={3} maxLength={600} required value={message} onChange={(e) => setMessage(e.target.value)} />
          <p className={fieldHelp}>{t("ol.new.message.help")}</p>
        </div>
      ) : null}
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
        {sentence({ source, action, withinMinutes: minutes })}
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
        <button type="submit" className={btnMain} disabled={busy || (needsMessage && message.trim() === "")}>
          {busy ? t("pc.approving") : t("ol.rule.approve")}
        </button>
        <button type="button" className={btnQuiet} onClick={onCancel}>
          {t("ol.rule.cancel")}
        </button>
      </div>
    </form>
  );
}
