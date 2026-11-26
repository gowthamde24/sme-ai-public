"use client";

import { ASK_EVENT } from "@/components/v2/app/today/ask/ask-event";
import { AlertTriangle, Check, Clock, Info, Paperclip, Pencil, Phone, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import type { QueuedMessage, QueueRefusal, QueueResult } from "@/lib/api/chat-queue";

import { VoiceMic } from "../../../voice-input/LazyVoiceMic";
import { makeT, type Words } from "../../../words";
import { LANGS } from "../../../whatsapp/wa-model";
import type { ReplyResult } from "../../../whatsapp/wa-types";
import type { Failed } from "../../../cc/kit";
import { ReplyBox } from "../ReplyBox";
import { CAN_SEND, LIVE, READ_ONLY, viewOf, type Local, type QView } from "./queue-model";

/**
 * The composer of a chat whose 24 hour WhatsApp window is closed (owner, 19 Nov 2026): THE BOX IS ALWAYS THERE. The owner types normally; the message is queued, the approved hello goes first, and the message goes the moment the customer replies (also at night: an answer to a customer who
 * wrote first is never held). One status area under the box has ONE height for every state, so nothing jumps; its words are all keys (`chats6.q.*`). The 5-second poll runs only while the chat is open and visible; the tap is optimistic (the status shows at once, the answer fixes it).
 * A chunk of its own (LazyQueueComposer): the Chats route does not carry it, and it loads only when a window is closed.
 */
export type QueueActions = {
  queue: (clientId: string, text: string) => Promise<QueueResult<QueuedMessage>>;
  cancel: (id: string) => Promise<QueueResult<{ id: string; status: "cancelled" }>>;
  poll: () => Promise<QueueResult<QueuedMessage | null | undefined>>;
};
export type QueueComposerProps = {
  words: Words;
  leadId: string;
  /** the customer's first name, or "the customer" */
  first: string;
  /** what the page read: null = nothing waits (an ended or cancelled one was already left out) */
  initial: QueuedMessage | null;
  actions: QueueActions;
  /** the normal send, for a window that opened while the owner was typing (409 window_open) */
  reply: (messageId: string, text: string, language: string) => Promise<{ ok: true; data: ReplyResult } | Failed>;
  /** the customer's page, where a call is made from (its own approval and rules) */
  callHref: string;
  /** the plain page about the Do Not Call list */
  dncHref: string;
  /** a message went out: the page reads the thread again */
  onWent: () => void;
};

export const POLL_MS = 5000;
const pill = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-4 text-[14px] font-semibold disabled:opacity-60";
const pill1 = `${pill} bg-brand text-on-brand font-bold`;
const pill2 = `${pill} border border-line bg-surface text-ink hover:bg-surface-2`;

type Tone = "done" | "wait" | "fail" | "info";
const TONE_ICON = { done: Check, wait: Clock, fail: AlertTriangle, info: Info } as const;
function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <span data-tone={tone} className="cq-chip">
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}

export function QueueComposer(p: QueueComposerProps) {
  const t = makeT(p.words);
  const id = React.useId();
  const [text, setText] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [q, setQ] = React.useState<QueuedMessage | null>(p.initial);
  const [local, setLocal] = React.useState<Local>(null);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<QueueRefusal | "reply" | null>(null);
  const [attach, setAttach] = React.useState(false);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const qRef = React.useRef<QueuedMessage | null>(p.initial);
  const busyRef = React.useRef(false);
  const put = (next: QueuedMessage | null) => {
    qRef.current = next;
    setQ(next);
  };
  const work = (on: boolean) => {
    busyRef.current = on;
    setBusy(on);
  };

  const view: QView = viewOf(q, local, dismissed);
  const readOnly = READ_ONLY.includes(view);
  const shown = readOnly ? (q?.text ?? text) : text;

  // the 5-second read while the chat is open and visible; it only watches (a message made on another device, the customer's reply, STOP). A read that fails keeps what is shown.
  const { poll, queue, cancel } = p.actions;
  const { onWent } = p;
  React.useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      const r = await poll().catch(() => null);
      if (stopped || !r || !r.ok || r.data === undefined || busyRef.current) return;
      const before = qRef.current;
      if (r.data && r.data.status === "sent" && before && before.id === r.data.id && before.status !== "sent") {
        setLocal("sent"); // seen going out on this screen
        onWent();
      }
      if (r.data === null && before && LIVE.includes(viewOf(before, null))) return; // not read yet: keep the waiting message on screen
      qRef.current = r.data;
      setQ(r.data);
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, onWent]);

  async function sendNormally(words: string) {
    const r = await p.reply(crypto.randomUUID(), words, language).catch((): Failed => ({ ok: false, kind: "unavailable", error: "" }));
    if (!r.ok) return setErr("reply");
    setText("");
    setLocal("sent");
    onWent();
  }
  async function send(words: string) {
    if (busyRef.current || words === "") return;
    const clientId = crypto.randomUUID();
    setErr(null);
    setLocal(null);
    setText(words);
    // optimistic: the status shows at once, the answer fixes it
    put({ id: clientId, text: words, status: "waiting_for_reply", sendAt: null, queuedAt: new Date().toISOString(), expiresAt: null, continueChat: null, failureCode: null });
    work(true);
    const r = await queue(clientId, words).catch((): { ok: false; refusal: QueueRefusal } => ({ ok: false, refusal: "down" }));
    if (r.ok) {
      if (r.data.continueChat === "not_approved") {
        // the hello cannot go, so the message cannot go: said at once, the words stay in the box, and the queued one is taken back
        put(null);
        setLocal("hello");
        work(false);
        void cancel(r.data.id).catch(() => null);
        return;
      }
      put(r.data);
      setText("");
      work(false);
      return;
    }
    put(null);
    switch (r.refusal) {
      case "stopped_by_customer":
        setLocal("stopped");
        break;
      case "consent_required":
        setLocal("hello");
        break;
      case "window_open":
        await sendNormally(words);
        break;
      case "already_queued": {
        const again = await poll().catch(() => null);
        if (again && again.ok && again.data) put(again.data);
        else setErr("already_queued");
        break;
      }
      default:
        setErr(r.refusal);
    }
    work(false);
  }
  async function cancelIt() {
    const was = qRef.current;
    if (!was || busyRef.current) return;
    // optimistic and quiet: the box is back with the words
    setText(was.text);
    setErr(null);
    put(null);
    work(true);
    const r = await cancel(was.id).catch((): { ok: false; refusal: QueueRefusal } => ({ ok: false, refusal: "down" }));
    work(false);
    if (r.ok) return;
    // it already went (or the answer did not come): go back to what is true
    setText("");
    put(was);
    if (r.refusal === "not_waiting") {
      const again = await poll().catch(() => null);
      if (again && again.ok && again.data !== undefined) put(again.data);
    } else setErr(r.refusal);
  }
  function writeAgain() {
    if (!q) return;
    setDismissed(q.id);
    setText(q.text);
    boxRef.current?.focus();
  }
  const change = (v: string) => {
    setText(v);
    setErr(null);
    if (local === "sent") setLocal(null);
  };

  const call = (
    <Link href={p.callHref} className={pill2} data-part="queue-call">
      <Phone aria-hidden="true" className="size-4" />
      {t("chats6.q.call")}
    </Link>
  );
  const status = (): React.ReactNode => {
    switch (view) {
      case "waiting":
        return (
          <>
            <div>
              <Chip tone="wait">{t("chats6.q.waiting")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.waiting.line", { name: p.first })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void cancelIt()} disabled={busy} className={pill2} data-part="queue-cancel">
                <X aria-hidden="true" className="size-4" />
                {t("chats6.q.cancel")}
              </button>
              {call}
            </div>
          </>
        );
      case "sending":
        return (
          <>
            <div>
              <Chip tone="info">{t("chats6.q.sending")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.sending.line", { name: p.first })}</p>
          </>
        );
      case "sent":
        return (
          <>
            <div>
              <Chip tone="done">{t("chats6.q.sent")}</Chip>
            </div>
            <p className="m-0 text-[13px] leading-snug text-muted">{t("chats6.q.sent.line")}</p>
          </>
        );
      case "failed":
        return (
          <>
            <div>
              <Chip tone="fail">{t("chats6.q.notsent")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.failed.line", { name: p.first })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void send(q?.text ?? text)} disabled={busy} className={pill1} data-part="queue-retry">
                <RotateCcw aria-hidden="true" className="size-4" />
                {t("chats6.q.retry")}
              </button>
              {call}
            </div>
          </>
        );
      case "expired":
        return (
          <>
            <div>
              <Chip tone="fail">{t("chats6.q.notsent")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.expired.line")}</p>
            <div className="flex flex-wrap gap-2">
              {call}
              <button type="button" onClick={writeAgain} className={pill2} data-part="queue-write-again">
                <Pencil aria-hidden="true" className="size-4" />
                {t("chats6.q.write_again")}
              </button>
            </div>
          </>
        );
      case "stopped":
        return (
          <>
            <div>
              <Chip tone="info">{t("chats6.q.stopped.chip")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.stopped.line")}</p>
            <div>
              <Link href={p.dncHref} className="inline-flex min-h-11 items-center text-[14px] font-semibold text-brand-text underline underline-offset-4" data-part="queue-dnc">
                {t("chats6.q.dnc")}
              </Link>
            </div>
          </>
        );
      case "hello":
        return (
          <>
            <div>
              <Chip tone="wait">{t("chats6.q.hello.chip")}</Chip>
            </div>
            <p className="m-0 text-sm leading-snug">{t("chats6.q.hello.line")}</p>
            <div className="flex flex-wrap gap-2">{call}</div>
          </>
        );
      default:
        return (
          <>
            {err ? (
              <p role="alert" className="m-0 text-sm font-medium leading-snug text-red-text" data-part="queue-error">
                {t(`chats6.q.err.${err}`)}
              </p>
            ) : (
              <p className="m-0 text-[13px] leading-snug text-muted" data-part="queue-help">
                {t("chats6.q.help")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">{call}</div>
          </>
        );
    }
  };

  return (
    <form
      className="flex scroll-mb-24 flex-col gap-1.5 px-3.5 pb-3.5 pt-1"
      data-part="composer"
      data-orb-avoid=""
      data-mode="queue"
      data-view={view}
      onSubmit={(e) => {
        e.preventDefault();
        if (CAN_SEND.includes(view)) void send(text.trim());
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label htmlFor={`${id}-text`} className="text-[13px] font-bold text-ink" data-part="composer-to">
            {t("chats6.composer.to", { name: p.first })}
          </label>
          <button type="button" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-brand-text underline underline-offset-4" data-part="ask-assistant">
            {t("chats6.composer.ask")}
          </button>
        </div>
        <ReplyBox id={`${id}-text`} inputRef={boxRef} value={shown} onChange={change} onSend={() => { if (CAN_SEND.includes(view) && text.trim() !== "") void send(text.trim()); }} maxLength={1000} placeholder={t("chats6.composer.placeholder", { name: p.first })} disabled={readOnly || busy} />
        <div data-part="queue-status" aria-live="polite" className="flex flex-col">
          <div key={view} data-state={view} className="flex flex-col gap-2.5">
            {status()}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-part="composer-tools">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={attach} onClick={() => setAttach((a) => !a)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-surface-2 aria-pressed:border-brand-edge" aria-label={t("chats6.attach")}>
              <Paperclip aria-hidden="true" className="size-5" />
            </button>
            <VoiceMic target={boxRef} focused />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select aria-label={t("wa.reply.language")} value={language} onChange={(e) => setLanguage(e.target.value)} className="min-h-11 shrink-0 rounded-md border border-line bg-surface px-3 text-[13px] text-ink">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {t(`today.lang.${l}`)}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy || !CAN_SEND.includes(view) || text.trim() === ""} className={`${pill1} shrink-0`} data-part="queue-send">
              {t("wa.reply.send")}
            </button>
          </div>
        </div>
      </div>
      {attach ? (
        <p role="note" className="m-0 text-sm text-muted">
          {t("chats6.attach.note")}
        </p>
      ) : null}
    </form>
  );
}
