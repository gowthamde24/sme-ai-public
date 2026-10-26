"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS, CHANNELS, GOALS, type BatchAnswer, type CallLang, type Channel, type Done, type Goal, type SourceTag } from "@/lib/outreach/types";

import { alertBox, btnMain, fieldHelp, fieldInput, fieldLabel, fieldTextarea, formStack, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Make a plan" for a batch of leads (night 4, part A3): the name, the goal, how (calls, WhatsApp or both), the language, what Vijaya asks, the words of the WhatsApp message, how many days, and the limits. It sends nothing: it makes
 * the PLAN CARD, which the Owner approves once. Who is in it is the lead source chosen on the page that links here (every new lead from that source). The batch id is made here, so pressing twice is the same plan.
 */
export type NewBatch = (input: unknown) => Promise<Done<BatchAnswer>>;
const STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;

export function BatchForm({ words, source, sourceLabel, defaultName, defaultGoal, defaultLanguage, languageNames, goalNames, plan, backHref, today }: { words: Words; source: SourceTag; sourceLabel: string; defaultName: string; defaultGoal: Goal; defaultLanguage: CallLang; languageNames: Readonly<Record<string, string>>; goalNames: Readonly<Record<string, string>>; plan: NewBatch; backHref: string; today: string }) {
  const t = makeT(words);
  const router = useRouter();
  const [id] = React.useState(() => crypto.randomUUID());
  const [name, setName] = React.useState(defaultName);
  const [goal, setGoal] = React.useState<Goal>(defaultGoal);
  const [channel, setChannel] = React.useState<Channel>("call");
  const [language, setLanguage] = React.useState<CallLang>(defaultLanguage);
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("new");
  const [questions, setQuestions] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [days, setDays] = React.useState(7);
  const [callsPerDay, setCallsPerDay] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsMessage = channel !== "call";
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    const qs = questions.split("\n").map((q) => q.trim()).filter(Boolean);
    const out = await plan({
      batchId: id,
      name,
      goal,
      channel,
      language,
      who: { kind: "source", source, status, since: null },
      questions: qs,
      messageText: needsMessage ? message : null,
      windowDays: days,
      maxCallsPerDay: num(callsPerDay),
      maxTotalMinutes: num(minutes),
    }).catch((): Done<BatchAnswer> => ({ ok: false, error: "down" }));
    setBusy(false);
    if (out.ok) router.push(`${backHref}/batches/${out.value.batch.id}`);
    else setError(t(out.error === "invalid" ? "ol.new.err.invalid" : out.error === "read_only" ? "pc.err.read_only" : "ol.new.err.down"));
  };

  return (
    <form data-part="batch-form" onSubmit={submit} className={`${surface} ${formStack}`}>
      <p className="text-base">{t("ol.new.who", { source: sourceLabel })}</p>
      <div>
        <label htmlFor="bf-name" className={fieldLabel}>
          {t("ol.new.name")}
        </label>
        <input id="bf-name" className={fieldInput} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="bf-status" className={fieldLabel}>
          {t("ol.new.status")}
        </label>
        <select id="bf-status" className={fieldInput} value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`ol.status.${s}` as "ol.status.new")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="bf-goal" className={fieldLabel}>
          {t("pc.goal")}
        </label>
        <select id="bf-goal" className={fieldInput} value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
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
            <input type="radio" name="bf-channel" className="size-5 accent-brand-text" checked={channel === c} onChange={() => setChannel(c)} />
            {t(`pc.channel.${c}` as "pc.channel.call")}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="bf-lang" className={fieldLabel}>
          {t("ol.new.language")}
        </label>
        <select id="bf-lang" className={fieldInput} value={language} onChange={(e) => setLanguage(e.target.value as CallLang)}>
          {CALL_LANGS.map((l) => (
            <option key={l} value={l}>
              {languageNames[l] ?? l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="bf-q" className={fieldLabel}>
          {t("ol.new.questions")}
        </label>
        <textarea id="bf-q" className={fieldTextarea} rows={4} value={questions} onChange={(e) => setQuestions(e.target.value)} />
        <p className={fieldHelp}>{t("ol.new.questions.help")}</p>
      </div>
      {needsMessage ? (
        <div>
          <label htmlFor="bf-m" className={fieldLabel}>
            {t("ol.new.message")}
          </label>
          <textarea id="bf-m" className={fieldTextarea} rows={3} maxLength={600} required value={message} onChange={(e) => setMessage(e.target.value)} />
          <p className={fieldHelp}>{t("ol.new.message.help")}</p>
        </div>
      ) : null}
      <div>
        <label htmlFor="bf-days" className={fieldLabel}>
          {t("ol.new.days")}
        </label>
        <input id="bf-days" type="number" inputMode="numeric" min={1} max={14} className={`${fieldInput} max-w-40`} value={days} onChange={(e) => setDays(Math.min(14, Math.max(1, Number(e.target.value) || 1)))} />
        <p className={fieldHelp}>{t("ol.new.days.help", { from: today })}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bf-cpd" className={fieldLabel}>
            {t("ol.new.callsperday")}
          </label>
          <input id="bf-cpd" type="number" inputMode="numeric" min={1} className={fieldInput} value={callsPerDay} onChange={(e) => setCallsPerDay(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bf-min" className={fieldLabel}>
            {t("ol.new.totalminutes")}
          </label>
          <input id="bf-min" type="number" inputMode="numeric" min={1} className={fieldInput} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
      </div>
      <p className={fieldHelp}>{t("ol.new.limits.help")}</p>
      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className={btnMain} disabled={busy || name.trim() === "" || (needsMessage && message.trim() === "")}>
          {busy ? t("ol.new.making") : t("ol.new.make")}
        </button>
      </div>
    </form>
  );
}
