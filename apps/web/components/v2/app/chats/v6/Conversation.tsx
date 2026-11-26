"use client";

import { ASK_EVENT } from "@/components/v2/app/today/ask/ask-event";
import { ChevronLeft, Paperclip, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { MessagePhotos } from "@/components/v2/app/catalogue/MessagePhotos";
import { TeachThis, type TeachActions } from "@/components/v2/app/ds/TeachThis";
import { NewPill, useStickyScroll } from "@/components/v2/app/ds/sticky-scroll";
import type { DecisionResult } from "@/components/v2/app/today/actions-types";
import type { QueuedMessage } from "@/lib/api/chat-queue";
import type { ChatTemplate, Thread, ThreadItem } from "@/lib/api/whatsapp";
import { avatarOf, chatTime, dayTime, filledPreview, windowClosedAt } from "@/lib/chats/display";
import { sentByAssistant } from "@/lib/chats/handling";

import { FailureNote } from "../../cc/FailureNote";
import { pillClass, type Failed } from "../../cc/kit";
import { indiaClock, indiaDay } from "../../today/time";
import { fieldTextarea } from "../../ui";
import { makeT, type Words } from "../../words";
import { VoiceMic } from "../../voice-input/LazyVoiceMic";
import { ReplyBox } from "./ReplyBox";
import { QueueComposer } from "./queue/LazyQueueComposer";
import type { QueueActions } from "./queue/QueueComposer";
import { chronological, failureWord, LANGS, OUT_TONE, outState } from "../../whatsapp/wa-model";
import type { ReplyResult } from "../../whatsapp/wa-types";

/** The reply of the assistant that waits for the owner's OK (an outbox message with status needs_approval for this chat). */
export type WaitingReply = { id: string; text: string; language: string; media: { position: number; thumb_url: string | null }[]; reasons: string[] };
type Out<T> = { ok: true; data: T } | Failed;
export type ConversationActions = {
  reply: (messageId: string, text: string, language: string) => Promise<Out<ReplyResult>>;
  /** An approved template to this chat (the 24 hour window is closed): its id only, never words. */
  sendTemplate: (templateId: string) => Promise<Out<ReplyResult>>;
  markRead: () => Promise<Out<null>>;
  approve: (id: string) => Promise<DecisionResult>;
  reject: (id: string) => Promise<DecisionResult>;
  edit: (id: string, text: string) => Promise<DecisionResult>;
  setAssistant: ((on: boolean) => Promise<{ ok: true; on: boolean } | { ok: false; error: string }>) | null;
};
export type ConversationProps = {
  /** false = the chat was put beside the list by the page, not opened by the person: it is not marked read (default true) */
  autoRead?: boolean;
  words: Words;
  leadId: string;
  name: string;
  thread: Thread;
  waiting: WaitingReply | null;
  /** Owner and Admin send, edit and decline the waiting reply; Sales reads it */
  canDecide: boolean;
  canReply: boolean;
  /** The approved templates for this chat, read only while the 24 hour window is closed: a list (empty = none approved), null = could not be read, undefined = not read (the window is open). */
  templates?: readonly ChatTemplate[] | null;
  /** CHAT_QUEUE_SCREENS: the composer queue. undefined = off (the old template picker for a closed window); null = on, nothing queued; else the message that waits (an ended one is already left out). */
  queued?: QueuedMessage | null;
  queue?: QueueActions;
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
const b1 = "inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-3.5 text-[13px] font-bold text-on-brand disabled:opacity-60";
const b2 = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";

/**
 * The middle column of the Chats page (design system v6): the chat's bubbles (the assistant's marked "sent by assistant", "Teach this" under each of them), the next reply in a glowing "REPLY READY · WAITING FOR YOUR OK" card with its words and catalogue photos and
 * Send / Edit / Write my own, the composer ("Type a message, or tell your assistant what to reply…", the mic, attach) and the per-chat "Assistant: on/off". Everything goes through the EXISTING outbox: Send is the approve (second factor, every rule re-checked), Edit is the
 * edit of a waiting message, Write my own declines the draft once your own words go. The auto-send policy decides what needs approval; nothing here skips it. WhatsApp sending is mocked on staging, and Attach is a sample (nothing is attached or sent). The customer's number is not shown.
 */
export function Conversation(p: ConversationProps) {
  const t = makeT(p.words);
  // "Ravi" for "Ravi Kumar": the window note and the composer speak to the customer by first name (owner, 18 Nov); without a name, "the customer"
  const [previewAll, setPreviewAll] = React.useState(false); // the template preview shows two lines; "Show all" opens it
  const closedAt = windowClosedAt(p.thread.items, p.thread.window_expires_at);
  const first = p.name.trim().split(/\s+/)[0] || t("chats6.the_customer");
  // a template shows a plain name (lead_ack = "Thanks for your enquiry"); an internal name this app has no word for shows as readable words
  const tplTitle = (x: { name: string; purpose?: string | null }): string => {
    const own = p.words[`chats6.tplname.${x.name}`] ?? (x.purpose ? p.words[`chats6.tplname.${x.purpose}`] : undefined);
    if (own) return own;
    const plain = x.name.replace(/_/g, " ").trim();
    return plain.charAt(0).toUpperCase() + plain.slice(1);
  };
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
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const [tplId, setTplId] = React.useState<string | null>(null);
  const queueMode = !p.thread.window_open && p.queued !== undefined && p.queue !== undefined;
  const templateMode = !queueMode && !p.thread.window_open && p.templates !== undefined;
  const went = React.useCallback(() => router.refresh(), [router]);
  const tpl = p.templates?.find((x) => x.id === tplId) ?? p.templates?.[0] ?? null;
  React.useEffect(() => {
    if (p.autoRead !== false && p.thread.items.some((i) => i.direction === "in")) void p.actions.markRead();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.leadId]);

  const items = chronological(p.thread.items).filter((m) => !(p.waiting && m.id === p.waiting.id));
  // the thread follows the newest message; a reader who scrolled up is left alone and gets a "↓ New" pill (owner, 14 Nov)
  const { ref: threadRef, onScroll: onThreadScroll, unseen: threadUnseen, toBottom: threadToBottom } = useStickyScroll<HTMLOListElement>(`${items.length}:${items.length > 0 ? items[items.length - 1].id : ""}:${p.waiting?.id ?? ""}`, p.leadId);
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
  async function sendTemplate() {
    if (!tpl) return;
    setBusy("reply");
    setFailure(null);
    setSaid(null);
    const r = await p.actions.sendTemplate(tpl.id).catch((): Failed => ({ ok: false, kind: "unavailable", error: t("today.err.generic") }));
    setBusy(null);
    if (!r.ok) return setFailure(r);
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

  // a message that was not sent says WHY in one line (C1's closed reason or failure) and, when there is something the person can do, the next step as a button (owner, 16 Nov): a closed 24 hours -> pick a template; a failed send -> write it again; WhatsApp not set up -> set it up
  const setupHref = `${p.backHref.replace(/\/chats.*$/, "")}/integrations/whatsapp`;
  const pickTemplate = () => {
    const form = document.querySelector('[data-part="composer"]') as HTMLElement | null;
    form?.scrollIntoView({ block: "center", behavior: "smooth" });
    (document.getElementById(`${id}-tpl`) as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const appBase = p.backHref.replace(/\/chats.*$/, "");
  const nextStepOf = (m: ThreadItem): NextStep | null => {
    if (m.direction !== "out") return null;
    // C1's `not_sent` (16 Nov) says why, what to try and which button; its `action` word picks the button
    if (m.notSent) {
      switch (m.notSent.action) {
        case "send_template":
          return p.canReply && templateMode ? { kind: "template", run: pickTemplate } : null; // (with the queue on there is no picker: the box is always there)
        case "open_approvals":
          return p.canDecide ? { kind: "link", href: `${appBase}/outbox`, label: "chats6.next.approvals" } : null;
        case "open_templates":
          return p.canDecide ? { kind: "link", href: `${appBase}/chats/templates`, label: "chats6.next.templates" } : null;
        case "open_settings":
          return p.canDecide ? { kind: "link", href: `${appBase}/integrations/whatsapp`, label: "chats6.next.settings" } : null;
        case "open_consent":
          return { kind: "link", href: p.customerHref, label: "chats6.next.consent" };
        case "check_number":
          return { kind: "link", href: p.customerHref, label: "chats6.next.number" };
        default:
          return null; // wait / none: nothing to press
      }
    }
    if (m.notSent === null && m.status !== "blocked" && m.status !== "failed") return null;
    // an API from before `not_sent`: read the closed reason and failure code here
    if (m.status !== "blocked" && m.status !== "failed") return null;
    const code = m.failure_code ?? m.delivery_error ?? m.reason ?? "";
    const closed = ["window_closed", "template_required", "no_inbound_window"].includes(code) || m.delivery_error === "window_closed";
    if (closed) return p.canReply && !p.thread.window_open && !queueMode ? { kind: "template", run: pickTemplate } : null;
    if (["not_configured", "no_key", "token_expired"].includes(code)) return p.canDecide ? { kind: "link", href: setupHref, label: "chats6.next.setup" } : null;
    if (["send_failed", "adapter_error", "timeout", "rejected", "rate_limited", "unreachable", "recipient_unreachable", "not_delivered_health", "spam_limited", "other_error"].includes(code)) {
      return p.canReply && p.thread.window_open && !p.thread.stopped ? { kind: "again", run: () => { setText(m.text); boxRef.current?.focus(); } } : null;
    }
    return null; // a customer who said STOP, no opt-in, a daily limit...: nothing the person can do from here; the reason says it
  };
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
        <div className="min-w-[7.5rem] flex-1 basis-0">
          <h2 className="m-0 truncate text-[15px] font-bold">{p.name}</h2>
          <p data-chat-sub="" className="m-0 truncate text-[12.5px] text-muted">{[t("chats6.channel"), p.source ? t("chats6.came_from", { source: p.source }) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <Link href={p.cardHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text lg:hidden" data-part="chat-card-link">
          <UserRound aria-hidden="true" className="size-4" />
          {t("chats6.customer")}
        </Link>
        <Link href={p.customerHref} className="hidden min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink hover:bg-surface-2 sm:inline-flex" data-part="chat-call" aria-label={t("chats6.call")}>
          <Phone aria-hidden="true" className="size-4" />
          <span className="max-2xl:sr-only">{t("chats6.call")}</span>
        </Link>
        {p.switchState !== "hidden" ? (
          <button type="button" role="switch" aria-checked={on} disabled={p.switchState === "locked"} onClick={() => void flip()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-70" data-part="assistant-switch">
            <span aria-hidden="true" className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-brand" : "bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--v2-border)]"}`}>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
            </span>
            {on ? t("chats6.assistant.on") : t("chats6.assistant.off")}
          </button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto bg-bg bg-[radial-gradient(circle,var(--v2-border)_1px,transparent_1.2px)] [background-size:18px_18px]" data-part="chat-column">
        {p.thread.stopped ? (
          <p role="note" className="m-0 mx-4 mt-3 shrink-0 rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
            {t("wa.note.stopped")}
          </p>
        ) : p.thread.whatsapp_consent === "withdrawn" ? (
          <p role="note" className="m-0 mx-4 mt-3 shrink-0 rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
            {t("wa.note.withdrawn")}
          </p>
        ) : !p.thread.window_open && !queueMode ? (
          <p role="note" data-part="window-note" className="m-0 mx-4 mt-3 shrink-0 rounded-lg border border-amber-text bg-amber-bg px-3 py-1.5 text-sm font-medium leading-snug text-amber-text">
            {t("chats6.window.note", { name: first })}
            {closedAt ? <span className="font-normal" data-part="window-closed-at"> {t("chats6.window.closed_at", { when: dayTime(closedAt) })}</span> : null}
          </p>
        ) : null}
        {!on && p.switchState !== "hidden" ? (
          <p role="note" className="m-0 mx-4 mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
            {t("chats6.assistant.off.note")}
          </p>
        ) : null}
        <div className="relative flex min-h-48 min-w-0 flex-1 shrink-0 flex-col">
        <ol ref={threadRef} onScroll={onThreadScroll} className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2.5 overflow-y-auto p-[18px] text-sm leading-[1.45]" aria-label={t("wa.thread.messages")}>
          {items.length === 0 ? <li className="text-base text-muted">{t("wa.thread.none")}</li> : null}
          {items.map((m, i) => (
            <React.Fragment key={`${m.direction}-${m.id}`}>
              {i === 0 || day(items[i - 1].at) !== day(m.at) ? (
                <li className="self-center rounded border border-line bg-surface px-2.5 py-[3px] text-[11.5px] text-muted" data-part="day">
                  {day(m.at) === today ? t("chats6.today") : chatTime(m.at, p.now, t("chats6.yesterday"))}
                </li>
              ) : null}
              <Bubble m={m} index={i} t={t} words={p.words} teach={p.teach} next={nextStepOf(m)} />
            </React.Fragment>
          ))}
        </ol>
        <NewPill unseen={threadUnseen} onClick={threadToBottom} label={t("wa.thread.new")} />
        </div>

        {p.waiting ? (
          <article className="ds-glow mx-[18px] mb-3 flex flex-col gap-2.5 rounded-xl p-3.5" data-part="reply-ready" aria-labelledby={`${id}-ready`}>
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
                    composer.current?.querySelector("textarea")?.focus();
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

        {p.canReply && queueMode && p.queue ? (
          <QueueComposer
            key={p.leadId}
            words={p.words}
            leadId={p.leadId}
            first={first}
            initial={p.queued ?? null}
            actions={p.queue}
            reply={p.actions.reply}
            callHref={p.customerHref}
            dncHref={`${appBase}/do-not-call`}
            onWent={went}
          />
        ) : null}
        {p.canReply && templateMode ? (
          <form
            className="sticky bottom-0 z-10 flex scroll-mb-24 flex-col gap-2 border-t border-line bg-surface px-3.5 pb-3 pt-2.5 shadow-[0_-8px_8px_-8px_var(--v2-border)]"
            data-part="composer" data-orb-avoid=""
            data-mode="template"
            data-row="template-send-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy === null) void sendTemplate();
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="m-0 text-[13px] font-bold text-ink">{t("chats6.tpl.title")}</h3>
              {p.canDecide ? (
                <Link href={`${p.backHref.replace(/\/chats.*$/, "")}/chats/templates`} className="text-[13px] font-semibold text-brand-text underline underline-offset-4" data-part="see-templates">
                  {t("chats6.tpl.see")}
                </Link>
              ) : null}
            </div>
            {p.templates === null ? (
              <p role="note" className="m-0 text-sm font-medium text-amber-text" data-part="template-none">
                {t("chats6.tpl.unread")}
              </p>
            ) : p.templates?.length === 0 ? (
              <p role="note" className="m-0 text-sm font-medium text-amber-text" data-part="template-none">
                {t("chats6.tpl.none")}
              </p>
            ) : (
              <>
                {tpl ? (
                  <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-2 px-3 py-2" data-part="template-preview">
                    <p className={`m-0 whitespace-pre-wrap text-[14px] leading-5 text-ink [overflow-wrap:anywhere] ${previewAll ? "" : "line-clamp-2"}`} data-part="template-text">{filledPreview(tpl.preview, tpl.variables)}</p>
                    {previewAll && tpl.variables.length > 0 ? (
                      <p className="m-0 text-xs text-muted" data-part="template-variables">
                        {t("chats6.tpl.vars")}: {tpl.variables.map((v) => `${v.label}: ${v.value ?? "—"}`).join(" · ")}
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted" data-part="template-internal">{tpl.name}</span>
                      <button type="button" aria-expanded={previewAll} onClick={() => setPreviewAll((v) => !v)} className="inline-flex min-h-8 items-center text-xs font-semibold text-brand-text underline underline-offset-4" data-part="template-expand">
                        {previewAll ? t("chats6.tpl.show_less") : t("chats6.tpl.show_all")}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <label htmlFor={`${id}-tpl`} className="sr-only">
                    {t("chats6.tpl.pick")}
                  </label>
                  <select id={`${id}-tpl`} value={tpl?.id ?? ""} onChange={(e) => setTplId(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink">
                    {p.templates?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {tplTitle(x)}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={busy !== null || !tpl} className={`${b1} shrink-0`}>
                    {busy === "reply" ? t("dta.btn.working") : t("chats6.tpl.send")}
                  </button>
                </div>
              </>
            )}
          </form>
        ) : null}
        {p.canReply && !templateMode && !queueMode ? (
          <form
            className="flex scroll-mb-24 flex-col gap-1.5 px-3.5 pb-3.5 pt-1"
            data-part="composer" data-orb-avoid=""
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div ref={composer} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label htmlFor={`${id}-text`} className="text-[13px] font-bold text-ink" data-part="composer-to">
                  {t("chats6.composer.to", { name: first })}
                </label>
                <button type="button" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-brand-text underline underline-offset-4" data-part="ask-assistant">
                  {t("chats6.composer.ask")}
                </button>
              </div>
              <ReplyBox id={`${id}-text`} inputRef={boxRef} value={text} onChange={setText} onSend={() => { if (busy === null && text.trim() !== "") void send(); }} maxLength={1000} placeholder={t("chats6.composer.placeholder", { name: first })} />
              <div className="flex flex-wrap items-center gap-2" data-part="composer-tools">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" aria-pressed={attach} onClick={() => setAttach((a) => !a)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface-2 aria-pressed:border-brand-edge" aria-label={t("chats6.attach")}>
                    <Paperclip aria-hidden="true" className="size-5" />
                  </button>
                  {/* the language chip is always there (not only on focus): the toolbar never changes shape when the box gains or loses focus, so Send does not move under the finger */}
                  <VoiceMic target={boxRef} focused />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <select aria-label={t("wa.reply.language")} value={language} onChange={(e) => setLanguage(e.target.value)} className="min-h-11 shrink-0 rounded-xl border border-line bg-surface px-2 text-[13px] text-ink">
                    {LANGS.map((l) => (
                      <option key={l} value={l}>
                        {t(`today.lang.${l}`)}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={busy !== null || text.trim() === ""} className={`${b1} shrink-0`}>
                    {busy === "reply" ? t("dta.btn.working") : t("wa.reply.send")}
                  </button>
                </div>
              </div>
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

/** The closed word that says why a message did not go: C1's `not_sent.code`, else the same word read from the message (an API from before `not_sent`). The words for it are ours (`chats6.ns.<code>`, in the person's language); the API's English sentence is the fallback for a word this screen does not know yet. */
function notSentCode(m: ThreadItem): string | null {
  if (m.direction !== "out") return null;
  if (m.notSent) return m.notSent.code;
  if (m.delivery === "failed" || (m.delivery_error && m.status === "sent" && m.delivery !== "delivered")) return m.delivery_error ?? "other_error";
  if (m.status === "failed") return m.failure_code ?? "send_failed";
  if (m.status === "blocked") return m.reason ?? "blocked";
  return null;
}

type NextStep = { kind: "template" | "again"; run: () => void } | { kind: "link"; href: string; label: string };
function Bubble({ m, index, t, words, teach, next }: { m: ThreadItem; index: number; t: ReturnType<typeof makeT>; words: Words; teach: TeachActions | null; next: NextStep | null }) {
  const mine = m.direction === "out";
  const assistant = sentByAssistant(m);
  const state = mine ? outState(m) : null;
  const isBad = mine && (m.status === "blocked" || m.status === "failed" || state === "blocked" || state === "failed");
  // one line: the failure word when WhatsApp gave one, else C1's closed reason for the block, else 'the reason is not known'
  const code = notSentCode(m);
  const ownText = code ? words[`chats6.ns.${code}`] : undefined; // who or what stopped it, in the person's language
  const ownNext = code ? words[`chats6.ns.${code}.next`] : undefined;
  const bad = mine ? (ownText ?? m.notSent?.text ?? failureWord(m, t) ?? (isBad ? (m.reason ? (words[`outbox.reason.${m.reason}`] ?? t("wa.derr.other_error")) : t("wa.derr.other_error")) : null)) : null;
  const ticks = state === "delivered" || state === "read" ? "✓✓" : state === "sent" ? "✓" : null;
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`} data-direction={m.direction} data-by={mine ? (assistant ? "assistant" : "owner") : "customer"}>
      <div className={`max-w-[68%] px-[13px] py-2.5 text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)] ${mine ? "rounded-[8px_8px_4px_8px] bg-surface-2" : "rounded-[8px_8px_8px_4px] border border-line bg-surface"}`}>
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
      {bad ? (
        <div className="flex max-w-[68%] flex-col items-end gap-1" data-part="not-sent">
          <p className="m-0 text-right text-sm font-medium text-red-text">{bad}</p>
          {ownNext ?? m.notSent?.nextStep ? (
            <p className="m-0 text-right text-sm text-muted" data-part="next-step-text">
              {ownNext ?? m.notSent?.nextStep}
            </p>
          ) : null}
          {next ? (
            next.kind === "link" ? (
              <Link href={next.href} className={b2} data-part="next-step">
                {t(next.label)}
              </Link>
            ) : (
              <button type="button" onClick={next.run} className={b2} data-part="next-step">
                {t(next.kind === "template" ? "chats6.next.template" : "chats6.next.again")}
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {assistant && m.status !== "blocked" ? <TeachThis words={words} source="chat" sourceId={m.id} lineIndex={index} line={m.text} actions={teach} /> : null}
    </li>
  );
}
