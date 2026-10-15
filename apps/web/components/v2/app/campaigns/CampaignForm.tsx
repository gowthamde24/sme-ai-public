"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CampaignOut } from "@contracts";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet, secondary } from "../visits/styles";
import { MAX_STEPS, exampleText, fieldsFor, fieldsUsed, insertField, isMoneyKind, readSteps, stepPhrase, type Field, type StepDraft } from "./campaign-logic";
import type { Kind } from "@/lib/api/campaigns";

const LANGS = ["en", "te", "hi", "kn"] as const;
type Refused = { ok: false; error: string; mfa?: boolean };
export type CampaignFormInput = { name: string; kind: Kind; language: (typeof LANGS)[number]; waTemplateId: string | null; messageText: string; steps: { offset_days: number; time: string }[]; callAfterStep: number | null; callWaitHours: number };
export type CampaignFormActions = { save: (id: string, input: CampaignFormInput) => Promise<{ ok: true; campaignId: string; backToDraft: boolean } | Refused> };
export type TemplateChoice = { id: string; name: string; language: string };

const EXAMPLE: Record<Field, string> = { name: "Ravi Kumar", amount: "₹12,500.00", due_date: "20 Oct 2026", reference: "INV-1001", business: "Your business" };

/**
 * Make or change a reminder campaign (job CQ; Owner, Admin and Sales may edit a draft, only the Owner approves). The kind (payment due, delivery update, fee due, event, exam, holiday: reminders only, no promotion) never
 * changes once made. The text is one fixed line with merge fields (name, amount, due date, reference, business): the amount is a number from your list or ledger, never made up. Steps are days from each person's own date
 * and a time of day. A money reminder may add a call step for a person who did not reply and has not paid. Saving an approved campaign sends it back to draft: it has to be checked and approved again.
 */
export function CampaignForm(p: { base: string; campaignId: string; campaign: CampaignOut | null; kinds: readonly Kind[]; templates: readonly TemplateChoice[]; words: TodayWords; actions: CampaignFormActions; go?: (href: string) => void }) {
  const { words, campaign } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [name, setName] = React.useState(campaign?.name ?? "");
  const [kind, setKind] = React.useState<Kind>(campaign?.kind ?? p.kinds[0] ?? "payment_due");
  const [language, setLanguage] = React.useState<(typeof LANGS)[number]>((campaign?.language as (typeof LANGS)[number]) ?? "en");
  const [template, setTemplate] = React.useState(campaign?.wa_template_id ?? "");
  const [text, setText] = React.useState(campaign?.message_text ?? "");
  const [steps, setSteps] = React.useState<StepDraft[]>(campaign ? campaign.steps.map((s) => ({ offset: String(s.offset_days), time: s.time })) : [{ offset: "-3", time: "10:00" }, { offset: "0", time: "10:00" }]);
  const [callAfter, setCallAfter] = React.useState(campaign?.call_after_step ? String(campaign.call_after_step) : "");
  const [wait, setWait] = React.useState(String(campaign?.call_wait_hours ?? 24));
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const money = isMoneyKind(kind);
  const matching = p.templates.filter((t) => t.language === language);
  const { used, bad } = fieldsUsed(text);
  const phrase = { before: (n: number) => say(words, "camp.step.before", { n }), on: () => say(words, "camp.step.on"), after: (n: number) => say(words, "camp.step.after", { n }) };

  function add(f: Field) {
    const at = area.current?.selectionStart ?? null;
    const next = insertField(text, f, at);
    setText(next.text);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }
  const setStep = (i: number, patch: Partial<StepDraft>) => setSteps((c) => c.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    if (busy) return;
    setProblem(null);
    if (name.trim() === "") return setProblem({ text: say(words, "camp.err.name") });
    if (text.trim().length < 8 || text.trim().length > 600) return setProblem({ text: say(words, "camp.err.text") });
    if (bad.length > 0) return setProblem({ text: say(words, "camp.err.field", { name: bad[0] }) });
    if (!money && used.includes("amount")) return setProblem({ text: say(words, "camp.err.amount") });
    const read = readSteps(steps);
    if (!read.ok) return setProblem({ text: say(words, `camp.err.steps.${read.reason}`) });
    const after = money && callAfter !== "" ? Number(callAfter) : null;
    if (after !== null && (after < 1 || after > read.steps.length)) return setProblem({ text: say(words, "camp.err.callplan") });
    const hours = Number(wait);
    if (after !== null && (!Number.isInteger(hours) || hours < 1 || hours > 168)) return setProblem({ text: say(words, "camp.err.wait") });
    setBusy(true);
    const out = await p.actions.save(p.campaignId, { name: name.trim(), kind, language, waTemplateId: template || null, messageText: text.trim(), steps: read.steps, callAfterStep: after, callWaitHours: after === null ? 24 : hours });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    go(`${p.base}/campaigns/${out.campaignId}${out.backToDraft ? "?back=1" : "?saved=1"}`);
  }

  return (
    <form data-screen="campaign-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-2xl flex-col gap-5">
      <div>
        <label htmlFor="cf-name" className={label}>{say(words, "camp.field.name")}</label>
        <input id="cf-name" value={name} maxLength={100} disabled={busy} onChange={(e) => setName(e.target.value)} aria-describedby="cf-name-h" className={field} />
        <p id="cf-name-h" className={help}>{say(words, "camp.field.name.help")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="cf-kind" className={label}>{say(words, "camp.field.kind")}</label>
          <select id="cf-kind" value={kind} disabled={busy || campaign !== null} onChange={(e) => { setKind(e.target.value as Kind); setCallAfter(""); }} aria-describedby="cf-kind-h" className={field}>
            {p.kinds.map((k) => (<option key={k} value={k}>{say(words, `camp.kind.${k}`)}</option>))}
          </select>
          <p id="cf-kind-h" className={help}>{say(words, campaign ? "camp.field.kind.fixed" : "camp.field.kind.help")}</p>
        </div>
        <div>
          <label htmlFor="cf-lang" className={label}>{say(words, "camp.field.language")}</label>
          <select id="cf-lang" value={language} disabled={busy} onChange={(e) => { setLanguage(e.target.value as (typeof LANGS)[number]); setTemplate(""); }} aria-describedby="cf-lang-h" className={field}>
            {LANGS.map((l) => (<option key={l} value={l}>{say(words, `today.lang.${l}`)}</option>))}
          </select>
          <p id="cf-lang-h" className={help}>{say(words, "camp.field.language.help")}</p>
        </div>
      </div>
      <div>
        <label htmlFor="cf-template" className={label}>{say(words, "camp.field.template")}</label>
        <select id="cf-template" value={template} disabled={busy} onChange={(e) => setTemplate(e.target.value)} aria-describedby="cf-template-h" className={field}>
          <option value="">{say(words, "camp.field.template.none")}</option>
          {matching.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
        <p id="cf-template-h" className={help}>
          {matching.length === 0 ? say(words, "camp.field.template.empty") : say(words, "camp.field.template.help")}{" "}
          <Link href={`${p.base}/integrations/whatsapp`} className="font-semibold underline">{say(words, "camp.field.template.link")}</Link>
        </p>
      </div>
      <div>
        <label htmlFor="cf-text" className={label}>{say(words, "camp.field.text")}</label>
        <textarea id="cf-text" ref={area} rows={4} value={text} maxLength={600} disabled={busy} onChange={(e) => setText(e.target.value)} aria-describedby="cf-text-h" className={`${field} py-2`} />
        <div role="group" aria-label={say(words, "camp.field.fields")} className="mt-2 flex flex-wrap gap-2">
          {fieldsFor(kind).map((f) => (
            <button key={f} type="button" disabled={busy} onClick={() => add(f)} className="inline-flex min-h-11 items-center rounded-full border border-edge px-3 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60">{say(words, `camp.fieldname.${f}`)}</button>
          ))}
        </div>
        <p id="cf-text-h" className={help}>{say(words, "camp.field.text.help")}</p>
        {bad.length > 0 ? <p role="note" className="mt-1 text-sm font-medium text-red-text">{say(words, "camp.err.field", { name: bad[0] })}</p> : null}
        {text.trim() !== "" ? (
          <div className="mt-2 rounded-xl border border-line bg-surface-2 p-3" data-part="example">
            <p className="text-sm font-semibold text-muted">{say(words, "camp.example")}</p>
            <p className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{exampleText(text, EXAMPLE)}</p>
          </div>
        ) : null}
      </div>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "camp.steps.title")}</legend>
        <p className={help}>{say(words, "camp.steps.help")}</p>
        {steps.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" data-step={i + 1}>
            <div>
              <label htmlFor={`cf-off-${i}`} className={label}>{say(words, "camp.steps.days", { n: i + 1 })}</label>
              <input id={`cf-off-${i}`} inputMode="numeric" value={s.offset} disabled={busy} onChange={(e) => setStep(i, { offset: e.target.value })} className={field} />
              <p className="mt-1 text-sm text-muted">{Number.isInteger(Number(s.offset)) && s.offset.trim() !== "" ? stepPhrase(Number(s.offset), phrase) : ""}</p>
            </div>
            <div>
              <label htmlFor={`cf-time-${i}`} className={label}>{say(words, "camp.steps.time")}</label>
              <input id={`cf-time-${i}`} type="time" value={s.time} disabled={busy} onChange={(e) => setStep(i, { time: e.target.value })} className={field} />
            </div>
            <button type="button" className={quiet} disabled={busy || steps.length <= 1} aria-label={say(words, "camp.steps.remove", { n: i + 1 })} onClick={() => setSteps((c) => c.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div><button type="button" className={secondary} disabled={busy || steps.length >= MAX_STEPS} onClick={() => setSteps((c) => [...c, { offset: String((Number(c[c.length - 1]?.offset) || 0) + 1), time: c[c.length - 1]?.time ?? "10:00" }])}>{say(words, "camp.steps.add")}</button></div>
      </fieldset>
      {money ? (
        <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
          <legend className="px-1 font-display text-lg font-semibold">{say(words, "camp.call.title")}</legend>
          <p className={help}>{say(words, "camp.call.help")}</p>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor="cf-call" className={label}>{say(words, "camp.call.after")}</label>
              <select id="cf-call" value={callAfter} disabled={busy} onChange={(e) => setCallAfter(e.target.value)} className={field}>
                <option value="">{say(words, "camp.call.none")}</option>
                {steps.map((_, i) => (<option key={i} value={String(i + 1)}>{say(words, "camp.call.step", { n: i + 1 })}</option>))}
              </select>
            </div>
            {callAfter !== "" ? (
              <div>
                <label htmlFor="cf-wait" className={label}>{say(words, "camp.call.wait")}</label>
                <input id="cf-wait" inputMode="numeric" value={wait} disabled={busy} onChange={(e) => setWait(e.target.value)} className={field} />
              </div>
            ) : null}
          </div>
        </fieldset>
      ) : null}
      {campaign && campaign.status !== "draft" ? <p role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text">{say(words, "camp.save.backtodraft")}</p> : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
        <button type="submit" disabled={busy} className={primary}>{busy ? say(words, "today.act.working") : say(words, campaign ? "camp.save.edit" : "camp.save.new")}</button>
        <Link href={campaign ? `${p.base}/campaigns/${campaign.id}` : `${p.base}/campaigns`} aria-disabled={busy} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
