"use client";

import { ChevronLeft, Paperclip, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { MessagePhotos } from "@/components/v2/app/catalogue/MessagePhotos";
import { TeachThis, type TeachActions } from "@/components/v2/app/ds/TeachThis";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { Thread, ThreadItem } from "@/lib/api/whatsapp";
import { avatarOf, chatTime } from "@/lib/chats/display";
import { sentByAssistant } from "@/lib/chats/handling";

import { FailureNote } from "../../cc/FailureNote";
import { pillClass, type Failed } from "../../cc/kit";
import { indiaClock, indiaDay } from "../../today/time";
import { DictInput } from "../../voice-input/Dictatable";
import { fieldTextarea } from "../../ui";
import { makeT, type Words } from "../../words";
import { chronological, failureWord, LANGS, OUT_TONE, outState } from "../../whatsapp/wa-model";
import type { ReplyResult } from "../../whatsapp/wa-types";

/** The reply of the assistant that waits for the owner's OK (an outbox message with status needs_approval for this chat). */
export type WaitingReply = { id: string; text: string; language: string; media: { position: number; thumb_url: string | null }[]; reasons: string[] };
type Out<T> = { ok: true; data: T } | Failed;
export type ConversationActions = {
  reply: (messageId: string, text: string, language: string) => Promise<Out<ReplyResult>>;
  markRead: () => Promise<Out<null>>;
  approve: (id: string) => Promise<DecisionResult>;
  reject: (id: string) => Promise<DecisionResult>;
  edit: (id: string, text: string) => Promise<DecisionResult>;
  setAssistant: ((on: boolean) => Promise<{ ok: true; on: boolean } | { ok: false; error: string }>) | null;
};
export type ConversationProps = {
  words: Words;
  leadId: string;
  name: string;
  thread: Thread;
  waiting: WaitingReply | null;
  /** Owner and Admin send, edit and decline the waiting reply; Sales reads it */
  canDecide: boolean;
  canReply: boolean;
  assistantOn: boolean;
  /** the switch is drawn (the flag) and the person may flip it */
  switchState: "hidden" | "locked" | "free";
  teach: TeachActions | null;
  actions: ConversationActions;
  backHref: string;
  cardHref: string;
  /** the customer's page (where a call is made from), the source in words, and the moment the page is drawn (ms) */
  customerHref: string;
  source: string | null;
  now: number;
};

const REFRESH_MS = 20_000;
const b1 = "inline-flex min-h-11 items-center justify-center rounded-[9px] bg-brand px-3.5 text-[13px] font-bold text-on-brand disabled:opacity-60";
const b2 = "inline-flex min-h-11 items-center justify-center rounded-[9px] border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";

/**
 * The middle column of the Chats page (design system v6): the chat's bubbles (the assistant's marked "sent by assistant", "Teach this" under each of them), the next reply in a glowing "REPLY READY · WAITING FOR YOUR OK" card with its words and catalogue photos and
 * Send / Edit / Write my own, the composer ("Type a message, or tell your assistant what to reply…", the mic, attach) and the per-chat "Assistant: on/off". Everything goes through the EXISTING outbox: Send is the approve (second factor, every rule re-checked), Edit is the
 * edit of a waiting message, Write my own declines the draft once your own words go. The auto-send policy decides what needs approval; nothing here skips it. WhatsApp sending is mocked on staging, and Attach is a sample (nothing is attached or sent). The customer's number is not shown.
 */
export function Conversation(p: ConversationProps) {
  const t = makeT(p.words);
  const router = useRouter();
  const id = React.useId();
  const [text, setText] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [own, setOwn] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [failure, setFailure] = React.useState<Failed | null>(null);
  const [attach, setAttach] = React.useState(false);
  const [on, setOn] = React.useState(p.assistantOn);
  const [waitingText, setWaitingText] = React.useState(p.waiting?.text ?? "");
  const composer = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (p.thread.items.some((i) => i.direction === "in")) void p.actions.markRead();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.leadId]);

  const items = chronological(p.thread.items).filter((m) => !(p.waiting && m.id === p.waiting.id));
  const result = (r: ReplyResult): string => {
    if (r.status === "sent") return t("wa.said.sent");
    if (r.status === "queued") return t(r.reason === "quiet_hours" ? "wa.said.held" : "wa.said.queued");
    if (r.status === "needs_approval") return t("wa.said.waiting");
    return t("wa.said.blocked", { why: p.words[`outbox.reason.${r.reason}`] ?? t("wa.derr.other_error") });
  };
  async function decide(what: "approve" | "reject") {
    if (!p.waiting) return;
    setBusy(what);
    setFailure(null);
    setSaid(null);
    const r = await (what === "approve" ? p.actions.approve(p.waiting.id) : p.actions.reject(p.waiting.id)).catch(() => ({ ok: false as const, error: t("today.err.generic") }));
    setBusy(null);
    if (!r.ok) return setSaid({ ok: false, text: r.error });
    setSaid({ ok: true, text: r.message });
    router.refresh();
  }
  async function saveEdit() {
    if (!p.waiting) return;
    setBusy("edit");
    const r = await p.actions.edit(p.waiting.id, waitingText).catch(() => ({ ok: false as const, error: t("today.err.generic") }));
    setBusy(null);
    if (!r.ok) return setSaid({ ok: false, text: r.error });
    if (r.text) setWaitingText(r.text);
    setEditing(null);
    setSaid({ ok: true, text: r.message });
  }
  async function send() {
    const words = text.trim();
    if (!words) return;
    setBusy("reply");
    setFailure(null);
    setSaid(null);
    const r = await p.actions.reply(crypto.randomUUID(), words, language);
    if (!r.ok) {
      setBusy(null);
      return setFailure(r);
    }
    if (own && p.waiting) await p.actions.reject(p.waiting.id).catch(() => null); // your own words replace the assistant's draft
    setBusy(null);
    setText("");
    setOwn(false);
    setSaid({ ok: true, text: result(r.data) });
    router.refresh();
  }
  async function flip() {
    if (!p.actions.setAssistant || p.switchState !== "free") return;
    const next = !on;
    setOn(next);
    const r = await p.actions.setAssistant(next).catch(() => ({ ok: false as const, error: "down" }));
    if (!r.ok) setOn(!next);
  }

  const day = (iso: string) => indiaDay(iso);
  const today = indiaDay(new Date(p.now).toISOString());
  const av = avatarOf(p.name);
  return (
    <section className="flex min-h-0 min-w-0 flex-col" data-chat="conversation" aria-label={p.name}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-[18px] py-3">
        <Link href={p.backHref} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-text lg:hidden">
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t("chats6.back")}
        </Link>
        <span aria-hidden="true" data-c={av.colour} className="ds-av hidden size-10 shrink-0 items-center justify-center rounded-full font-extrabold sm:inline-flex">
          {av.letter}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[15px] font-bold">{p.name}</h2>
          <p className="m-0 truncate text-[12.5px] text-muted">{[t("chats6.channel"), p.source ? t("chats6.came_from", { source: p.source }) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <Link href={p.cardHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text lg:hidden" data-part="chat-card-link">
          <UserRound aria-hidden="true" className="size-4" />
          {t("chats6.customer")}
        </Link>
        <Link href={p.customerHref} className="hidden min-h-11 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 sm:inline-flex" data-part="chat-call">
          <Phone aria-hidden="true" className="size-4" />
          {t("chats6.call")}
        </Link>
        {p.switchState !== "hidden" ? (
          <button type="button" role="switch" aria-checked={on} disabled={p.switchState === "locked"} onClick={() => void flip()} className="inline-flex min-h-11 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-70" data-part="assistant-switch">
            <span aria-hidden="true" className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-brand" : "bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--v2-border)]"}`}>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
            </span>
            {on ? t("chats6.assistant.on") : t("chats6.assistant.off")}
          </button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-bg bg-[radial-gradient(circle,var(--v2-border)_1px,transparent_1.2px)] [background-size:18px_18px]">
        {p.thread.stopped ? (
          <p role="note" className="m-0 mx-4 mt-3 rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
            {t("wa.note.stopped")}
          </p>
        ) : p.thread.whatsapp_consent === "withdrawn" ? (
          <p role="note" className="m-0 mx-4 mt-3 rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
            {t("wa.note.withdrawn")}
          </p>
        ) : !p.thread.window_open ? (
          <p role="note" className="m-0 mx-4 mt-3 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-base font-medium text-amber-text">
            {t("wa.note.window")}
          </p>
        ) : null}
        {!on && p.switchState !== "hidden" ? (
          <p role="note" className="m-0 mx-4 mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
            {t("chats6.assistant.off.note")}
          </p>
        ) : null}
        <ol className="m-0 flex min-h-40 flex-1 list-none flex-col gap-2.5 overflow-y-auto p-[18px] text-sm leading-[1.45]" aria-label={t("wa.thread.messages")}>
          {items.length === 0 ? <li className="text-base text-muted">{t("wa.thread.none")}</li> : null}
          {items.map((m, i) => (
            <React.Fragment key={`${m.direction}-${m.id}`}>
              {i === 0 || day(items[i - 1].at) !== day(m.at) ? (
                <li className="self-center rounded-full border border-line bg-surface px-2.5 py-[3px] text-[11.5px] text-muted" data-part="day">
                  {day(m.at) === today ? t("chats6.today") : chatTime(m.at, p.now, t("chats6.yesterday"))}
                </li>
              ) : null}
              <Bubble m={m} index={i} t={t} words={p.words} teach={p.teach} />
            </React.Fragment>
          ))}
        </ol>

        {p.waiting ? (
          <article className="ds-glow mx-[18px] mb-3 flex flex-col gap-2.5 rounded-[18px] p-3.5" data-part="reply-ready" aria-labelledby={`${id}-ready`}>
            <h3 id={`${id}-ready`} className="m-0 flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-brand-text">
              <Orb px={22} state="ambient" />
              {t("chats6.ready.label")}
            </h3>
            {editing === p.waiting.id ? (
              <div className="flex flex-col gap-2">
                <label htmlFor={`${id}-edit`} className="text-sm font-semibold">
                  {t("chats6.ready.edit.label")}
                </label>
                <textarea id={`${id}-edit`} rows={4} maxLength={3000} value={waitingText} onChange={(e) => setWaitingText(e.target.value)} className={fieldTextarea} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null || waitingText.trim().length < 2} onClick={() => void saveEdit()} className={b1}>
                    {busy === "edit" ? t("dta.btn.working") : t("chats6.ready.edit.save")}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => (setEditing(null), setWaitingText(p.waiting?.text ?? ""))} className={b2}>
                    {t("chats6.ready.edit.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="m-0 whitespace-pre-wrap text-[14.5px] leading-[1.5] text-ink [overflow-wrap:anywhere]">{waitingText}</p>
            )}
            <MessagePhotos media={p.waiting.media} words={p.words} size="md" />
            {p.canDecide && editing !== p.waiting.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy !== null} onClick={() => void decide("approve")} className={b1}>
                  {busy === "approve" ? t("dta.btn.working") : t("chats6.ready.send")}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => setEditing(p.waiting!.id)} className={b2}>
                  {t("chats6.ready.edit")}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setOwn(true);
                    composer.current?.querySelector("input")?.focus();
                  }}
                  className={b2}
                >
                  {t("chats6.ready.own")}
                </button>
                {p.waiting.media.length ? <span className="ml-auto text-xs text-muted">{t("chats6.ready.photos")}</span> : null}
              </div>
            ) : !p.canDecide ? (
              <p className="m-0 text-sm font-medium text-muted">{t("chats6.ready.owner_only")}</p>
            ) : null}
            {p.waiting.reasons.length ? <p className="m-0 text-xs text-muted">{t("chats6.ready.why", { why: p.waiting.reasons.join(", ") })}</p> : null}
            <p className="m-0 text-xs text-muted">{t("chats6.ready.note")}</p>
          </article>
        ) : null}

        {p.canReply ? (
          <form
            className="flex flex-col gap-1.5 px-3.5 pb-3.5 pt-1"
            data-part="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div ref={composer} className="flex items-center gap-2.5">
              <label htmlFor={`${id}-text`} className="sr-only">
                {t("chats6.composer.label")}
              </label>
              <DictInput id={`${id}-text`} wrap="flex-1" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t("chats6.composer.placeholder")} className="min-h-12 w-full rounded-[14px] border border-line bg-surface px-3.5 text-[14px] text-ink placeholder:text-muted focus:border-brand-edge" />
              <button type="button" aria-pressed={attach} onClick={() => setAttach((a) => !a)} className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface-2 aria-pressed:border-brand-edge" aria-label={t("chats6.attach")}>
                <Paperclip aria-hidden="true" className="size-5" />
              </button>
              <select aria-label={t("wa.reply.language")} value={language} onChange={(e) => setLanguage(e.target.value)} className="hidden min-h-12 shrink-0 rounded-xl border border-line bg-surface px-2 text-[13px] text-ink md:block">
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {t(`today.lang.${l}`)}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={busy !== null || text.trim() === ""} className={`${b1} !min-h-12 shrink-0`}>
                {busy === "reply" ? t("dta.btn.working") : t("wa.reply.send")}
              </button>
            </div>
            {own ? <p className="m-0 text-sm text-brand-text">{t("chats6.ready.own.hint")}</p> : null}
            {attach ? (
              <p role="note" className="m-0 text-sm text-muted">
                {t("chats6.attach.note")}
              </p>
            ) : null}
            <p className="m-0 text-xs text-muted">{t("wa.reply.rules")}</p>
          </form>
        ) : null}
        <div className="px-4 pb-2">
          <FailureNote failure={failure} words={p.words} />
          {said ? (
            <p role={said.ok ? "status" : "alert"} className={`m-0 text-base font-medium ${said.ok ? "text-green-text" : "text-red-text"}`}>
              {said.text}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Bubble({ m, index, t, words, teach }: { m: ThreadItem; index: number; t: ReturnType<typeof makeT>; words: Words; teach: TeachActions | null }) {
  const mine = m.direction === "out";
  const assistant = sentByAssistant(m);
  const state = mine ? outState(m) : null;
  const bad = mine ? failureWord(m, t) : null;
  const ticks = state === "delivered" || state === "read" ? "✓✓" : state === "sent" ? "✓" : null;
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`} data-direction={m.direction} data-by={mine ? (assistant ? "assistant" : "owner") : "customer"}>
      <div className={`max-w-[68%] px-[13px] py-2.5 text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)] ${mine ? "rounded-[14px_14px_4px_14px] bg-brand-bg" : "rounded-[14px_14px_14px_4px] border border-line bg-surface"}`}>
        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
        {m.photos > 0 ? <p className="m-0 mt-1 text-sm text-muted">{t("wa.thread.photos", { n: m.photos })}</p> : null}
        <p className="m-0 mt-1 text-right text-[11px] text-muted">
          {indiaClock(m.at)}
          {assistant ? (
            <>
              {" · "}
              <span data-part="sent-by-assistant">{t("chats6.by_assistant")}</span>
            </>
          ) : null}
          {ticks ? ` ${ticks}` : null}
          {mine && state && !ticks ? <span className={`ml-1 ${pillClass(OUT_TONE[state])}`}>{t(`wa.out.${state}`)}</span> : null}
        </p>
      </div>
      {bad ? <p className="m-0 max-w-[68%] text-sm font-medium text-red-text">{bad}</p> : null}
      {assistant && m.status !== "blocked" ? <TeachThis words={words} source="chat" sourceId={m.id} lineIndex={index} line={m.text} actions={teach} /> : null}
    </li>
  );
}
