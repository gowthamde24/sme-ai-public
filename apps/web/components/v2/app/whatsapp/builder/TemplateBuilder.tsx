"use client";

import { ArrowRight, Lock, MessageCircle, Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { DRAFT_LANGS, applyFix, canSend, fixAll, fromEditable, runChecks, toEditable, type CheckResult, type Draft, type DraftLang, type Message } from "@/lib/templates/meta-checks";
import { DRAFT_TEXT_MAX, type OwnMessage, type OwnTitle } from "@/lib/templates/types";

import { VoiceMic } from "../../voice-input/VoiceMic";
import { jobBtnMain, jobBtnQuiet } from "../../jobs/detail/types";
import { makeT, type Words } from "../../words";
import type { BuilderActions } from "./builder-types";
import { MessageChecks } from "./MessageChecks";
import { NameText } from "./NameText";
import { WhatsAppPreview } from "./WhatsAppPreview";

const card = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5";
const field = "block w-full rounded-xl border border-edge bg-surface px-3 py-2 text-[16px] leading-snug text-ink";

function Step({ n, title, sub, children, part }: { n: number; title: string; sub: string; children: ReactNode; part: string }) {
  return (
    <section data-part={part} className={card}>
      <div className="mb-3 flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-on-brand">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="m-0 font-display text-[17px] font-bold leading-tight text-ink">{title}</h3>
          <p className="m-0 mt-0.5 text-[14px] leading-snug text-muted">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const STEPS = ["say", "written", "preview", "checks", "send", "status"] as const;

/**
 * THE OWN WHATSAPP MESSAGE BUILDER (JOBS; mock sheet r3-05): say it (text + mic) -> the assistant writes it in Telugu and English (the customer's name is a plain "Name" chip) -> the live WhatsApp preview with a Telugu/English switch -> the automatic checks
 * (lib/templates/meta-checks.ts, each with a one-tap Fix) -> send with the two-step code. Nothing reaches a customer: the message goes to WhatsApp for its one check, and only an approved message is ever used. The words say "message", never "template" or "variable".
 */
export function TemplateBuilder({ words, actions, secondFactor, mock, securityHref, business, onClose, onSent }: { words: Words; actions: BuilderActions; secondFactor: boolean; mock: boolean; securityHref: string; business: string; onClose: () => void; onSent: (m: OwnMessage) => void }) {
  const t = makeT(words);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [sayError, setSayError] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [title, setTitle] = useState<OwnTitle>({ en: "", te: null });
  const [previewLang, setPreviewLang] = useState<DraftLang>("te");
  const [editing, setEditing] = useState<Partial<Record<DraftLang, boolean>>>({});
  const [changing, setChanging] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [needsFactor, setNeedsFactor] = useState(false); // the API still asked for a code (a refusal with `mfa`): then the way to Security is shown
  const confirmOnly = !secondFactor; // no authenticator: no code box, a plain Confirm step (owner 20 Nov)
  const results = useMemo(() => (message ? runChecks(message) : []), [message]);
  const ready = message !== null && canSend(message);
  const group = message ? t(`jobs.tb.cat.${message.category}`) : "";
  const sample = t("jobs.tb.sample_name");
  const chip = t("jobs.tb.name");
  const current = message === null ? 1 : ready ? 5 : 4;

  async function write(instruction: string, previous: Message | null) {
    setWriting(true);
    setSayError(null);
    setUnclear(false);
    const r = await actions.write(instruction, previous).catch(() => null);
    setWriting(false);
    if (!r) return void setSayError(t("today.err.generic"));
    if (!r.ok) return void setSayError(r.error);
    if (r.data.kind === "unclear") return void setUnclear(true);
    setMessage({ category: r.data.message.category, drafts: r.data.message.drafts });
    setTitle(r.data.message.title);
    setEditing({});
    setChanging(false);
    setChangeText("");
    setCode("");
    setSendError(null);
  }
  const patchDraft = (lang: DraftLang, patch: Partial<Draft>) => setMessage((m) => (m ? { ...m, drafts: { ...m.drafts, [lang]: { ...m.drafts[lang], ...patch } } } : m));
  const fix = (r: CheckResult) => r.fix && setMessage((m) => (m ? applyFix(m, r.fix as NonNullable<CheckResult["fix"]>) : m));

  async function send() {
    if (!message || !ready) return;
    setSending(true);
    setSendError(null);
    const r = await actions.submit({ title, message }, code.replace(/\s/g, "")).catch(() => null);
    setSending(false);
    if (!r) return void setSendError(t("today.err.generic"));
    if (!r.ok) {
      if (r.kind === "mfa") setNeedsFactor(true);
      return void setSendError(r.error);
    }
    onSent(r.data);
  }

  return (
    <div data-part="builder" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 font-display text-[20px] font-bold leading-tight text-ink md:text-[22px]">{t("jobs.tb.title")}</h3>
        </div>
        <button type="button" onClick={onClose} className={jobBtnQuiet}>
          {t("jobs.tb.close")}
        </button>
      </div>
      <ol aria-label={t("jobs.tb.steps")} className="m-0 flex list-none items-start justify-between gap-1 p-0">
        {STEPS.map((s, i) => (
          <li key={s} data-step={s} aria-current={i + 1 === current ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center text-[12px] text-muted">
            <span aria-hidden="true" className={`grid size-7 place-items-center rounded-full text-[13px] font-bold ${i + 1 <= current ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"}`}>
              {i + 1}
            </span>
            <span className="max-w-full truncate">{t(`jobs.tb.step.${s}`)}</span>
          </li>
        ))}
      </ol>
      {mock ? (
        <p role="note" data-part="mock-note" className="m-0 rounded-xl bg-[var(--jb-info-soft)] px-3 py-2 text-[14px] text-ink">
          {t("jobs.tb.mock_note")}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Step n={1} part="step-say" title={t("jobs.tb.s1.title")} sub={t("jobs.tb.s1.sub")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length >= 3 && !writing) void write(text, null);
            }}
            className="flex flex-col gap-3"
          >
            <div className="rounded-xl border border-brand-edge bg-surface p-2 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-brand)_25%,transparent)]">
              <textarea ref={boxRef} aria-label={t("jobs.tb.s1.title")} rows={2} maxLength={DRAFT_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("jobs.tb.s1.placeholder")} data-voice="allow" className="block w-full resize-none rounded-xl border-0 bg-transparent px-2 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-muted" />
              <div className="flex items-center justify-end gap-2">
                <VoiceMic target={boxRef} size="icon" />
              </div>
            </div>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] text-ink">
              {t("jobs.tb.s1.write_in")}
              <span className="rounded-md bg-brand-bg px-3.5 py-1 text-[15px] font-semibold text-brand-text">{t("jobs.tb.s1.langs")}</span>
            </p>
            <button type="submit" disabled={writing || text.trim().length < 3} data-action="write" className={`${jobBtnMain} w-full`}>
              <Sparkles aria-hidden="true" className="size-4" />
              {writing ? t("jobs.tb.s1.writing") : t("jobs.tb.s1.go")}
            </button>
            {unclear ? (
              <p role="status" data-part="unclear" className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] leading-snug text-ink">
                {t("jobs.tb.s1.unclear")}
              </p>
            ) : null}
            {sayError ? (
              <p role="alert" className="m-0 text-sm text-red-text">
                {sayError}
              </p>
            ) : null}
            <p className="m-0 text-[13.5px] leading-snug text-muted">{t("jobs.tb.s1.hint")}</p>
          </form>
        </Step>

        {message ? (
          <Step n={2} part="step-written" title={t("jobs.tb.s2.title")} sub={t("jobs.tb.s2.sub")}>
            <div className="grid gap-3">
              {DRAFT_LANGS.map((lang) => {
                const d = message.drafts[lang];
                const open = editing[lang] === true;
                return (
                  <div key={lang} data-draft={lang} className="min-w-0">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <b className="text-[15px] text-ink">{t(`jobs.tb.lang.${lang}`)}</b>
                      <button type="button" data-action="edit" aria-expanded={open} onClick={() => setEditing((e) => ({ ...e, [lang]: !open }))} className="jb-press -my-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[14px] font-semibold text-brand-text">
                        {open ? null : <Pencil aria-hidden="true" className="size-3.5" />}
                        {open ? t("jobs.tb.edit.done") : t("jobs.tb.edit")}
                      </button>
                    </div>
                    {open ? (
                      <div className="flex flex-col gap-2">
                        <label className="flex flex-col gap-1 text-[13px] text-muted">
                          {t("jobs.tb.part.header")}
                          <input lang={lang} value={toEditable(d.header ?? "")} onChange={(e) => patchDraft(lang, { header: fromEditable(e.target.value) || null })} className={field} />
                        </label>
                        <label className="flex flex-col gap-1 text-[13px] text-muted">
                          {t("jobs.tb.part.body")}
                          <textarea lang={lang} rows={5} value={toEditable(d.body)} onChange={(e) => patchDraft(lang, { body: fromEditable(e.target.value) })} className={field} />
                        </label>
                        <label className="flex flex-col gap-1 text-[13px] text-muted">
                          {t("jobs.tb.part.footer")}
                          <input lang={lang} value={toEditable(d.footer ?? "")} onChange={(e) => patchDraft(lang, { footer: fromEditable(e.target.value) || null })} className={field} />
                        </label>
                        <p className="m-0 text-[13px] text-muted">{t("jobs.tb.edit.hint")}</p>
                      </div>
                    ) : (
                      <div lang={lang} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[15px] leading-relaxed text-ink">
                        {d.header ? (
                          <b className="mb-1 block">
                            <NameText text={d.header} chip={chip} />
                          </b>
                        ) : null}
                        <NameText text={d.body} chip={chip} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" data-action="change" aria-expanded={changing} onClick={() => setChanging((c) => !c)} className={jobBtnQuiet}>
                <MessageCircle aria-hidden="true" className="size-4" />
                {t("jobs.tb.change.go")}
              </button>
              <span className="text-[13.5px] text-muted">{t("jobs.tb.name.note")}</span>
            </div>
            {changing ? <ChangeBox t={t} text={changeText} setText={setChangeText} busy={writing} onGo={() => void write(changeText, message)} /> : null}
          </Step>
        ) : null}
      </div>

      {message ? (
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          <Step n={3} part="step-preview" title={t("jobs.tb.s3.title")} sub={t("jobs.tb.s3.sub")}>
            <div role="group" aria-label={t("jobs.tb.s3.title")} className="mx-auto mb-3 flex w-fit rounded-md bg-surface-2 p-1">
              {DRAFT_LANGS.map((l) => (
                <button key={l} type="button" data-lang-switch={l} aria-pressed={previewLang === l} onClick={() => setPreviewLang(l)} className={`jb-press min-h-10 rounded-md px-5 text-[15px] font-semibold ${previewLang === l ? "bg-brand text-on-brand" : "text-ink"}`}>
                  {t(`jobs.tb.lang.${l}`)}
                </button>
              ))}
            </div>
            <WhatsAppPreview message={message} lang={previewLang} business={business} sample={sample} t={t} />
            <p className="m-0 mt-3 text-center text-[13.5px] text-muted">{t("jobs.tb.s3.note")}</p>
          </Step>
          <Step n={4} part="step-checks" title={t("jobs.tb.s4.title")} sub={t("jobs.tb.s4.sub")}>
            <MessageChecks results={results} t={t} canFix onFix={fix} onFixAll={() => setMessage((m) => (m ? fixAll(m) : m))} />
          </Step>
          <Step n={5} part="step-send" title={t("jobs.tb.s5.title")} sub={t("jobs.tb.s5.sub")}>
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <MessageCircle aria-hidden="true" className="size-5 shrink-0 text-muted" />
              <div className="min-w-0">
                <p className="m-0 truncate text-[15px] font-semibold text-ink">{title.en}</p>
                <p className="m-0 text-[13.5px] text-muted">{t("jobs.tb.s5.summary", { group })}</p>
              </div>
            </div>
            {!ready ? (
              <p role="status" data-part="send-blocked" className="m-0 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-2.5 text-[14.5px] leading-snug text-ink">
                {t("jobs.tb.s5.blocked")}
              </p>
            ) : needsFactor ? (
              <div role="note" data-part="no-factor" className="flex flex-col gap-2 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-3 text-[14.5px] leading-snug text-ink">
                <p className="m-0">{t("jobs.tb.s5.no_factor")}</p>
                <Link href={securityHref} prefetch={false} className={`${jobBtnQuiet} self-start no-underline`}>
                  {t("jobs.tb.s5.security")}
                </Link>
              </div>
            ) : confirmOnly ? (
              <div data-part="confirm-step" className="flex flex-col gap-3">
                <p className="m-0 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-3 text-[14.5px] leading-snug text-ink">
                  <b>{t("jobs.tb.s5.confirm.title")}</b> {t("jobs.tb.s5.confirm.body")}
                </p>
                <button type="button" data-action="send" disabled={sending} onClick={() => void send()} className={`${jobBtnMain} w-full`}>
                  <ArrowRight aria-hidden="true" className="size-4" />
                  {sending ? t("jobs.tb.s5.sending") : t("jobs.tb.s5.confirm.btn")}
                </button>
              </div>
            ) : (
              <form
                data-part="second-step"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d{6}$/.test(code) && !sending) void send();
                }}
                className="flex flex-col gap-3"
              >
                <div role="note" className="flex gap-2.5 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-3 text-[14.5px] leading-snug text-ink">
                  <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <p className="m-0">
                    <b>{t("jobs.tb.s5.step.title")}</b> {t("jobs.tb.s5.step.body")}
                  </p>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-muted">{t("jobs.tb.s5.code")}</span>
                  <input
                    name="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    data-voice="never"
                    placeholder="••••••"
                    className="min-h-12 w-full rounded-xl border-2 border-brand-edge bg-surface px-4 text-center text-[24px] font-bold tracking-[0.5em] text-ink"
                  />
                </label>
                <button type="submit" data-action="send" disabled={sending || !/^\d{6}$/.test(code)} className={`${jobBtnMain} w-full`}>
                  <ArrowRight aria-hidden="true" className="size-4" />
                  {sending ? t("jobs.tb.s5.sending") : t("jobs.tb.s5.send")}
                </button>
              </form>
            )}
            {sendError ? (
              <p role="alert" data-part="send-error" className="m-0 mt-2 text-sm text-red-text">
                {sendError}
              </p>
            ) : null}
            <p className="m-0 mt-3 text-[13.5px] leading-snug text-muted">{t("jobs.tb.s5.foot")}</p>
          </Step>
        </div>
      ) : null}
    </div>
  );
}

function ChangeBox({ t, text, setText, busy, onGo }: { t: ReturnType<typeof makeT>; text: string; setText: (s: string) => void; busy: boolean; onGo: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div data-part="change-box" className="mt-3 rounded-xl border border-brand-edge bg-surface p-2">
      <textarea ref={ref} aria-label={t("jobs.tb.change.go")} rows={2} maxLength={DRAFT_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("jobs.tb.change.placeholder")} data-voice="allow" className="block w-full resize-none rounded-xl border-0 bg-transparent px-2 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-muted" />
      <div className="flex items-center justify-end gap-2">
        <VoiceMic target={ref} size="icon" />
        <button type="button" data-action="change-go" disabled={busy || text.trim().length < 3} onClick={onGo} className={jobBtnMain}>
          {t("jobs.tb.change.apply")}
        </button>
      </div>
    </div>
  );
}
