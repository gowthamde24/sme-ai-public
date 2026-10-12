"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Thread, ThreadItem } from "@/lib/api/whatsapp";

import { FailureNote } from "../cc/FailureNote";
import { card, danger, field, h2, help, label as labelClass, okLine, pillClass, primary, quiet, selectClass, type Failed } from "../cc/kit";
import { indiaClock, indiaDay } from "../today/time";
import { makeT, type Say, type Words } from "../words";
import { chronological, failureWord, LANGS, OUT_TONE, outState } from "./wa-model";
import type { ChatActions, ReplyResult } from "./wa-types";

const REFRESH_MS = 20_000;
const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "pm" : "am"}`;

/**
 * One customer chat (job CC, screen 5): what they wrote and what was sent to them, oldest first, each message of ours with where it stands (waiting for the owner's OK, held for the morning, sent, delivered, read, blocked with
 * the reason in words, failed). The owner and admin can approve a waiting message (= send it, with the second factor) or decline it; a reply is a new message that goes through the same rules as every message (consent, a customer who
 * asked us to stop, quiet hours, the 24-hour window, the owner's OK for money and promises). The chat looks again every 20 seconds while the tab is in front. The customer's number is not shown.
 */
export function ChatThread({ words, thread: initial, role, quiet: quietHours, actions, now }: { words: Words; thread: Thread; role: string; quiet: { start: number; end: number } | null; actions: ChatActions; now: number }) {
  const t = makeT(words);
  const id = useId();
  const [thread, setThread] = useState(initial);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const alive = useRef(true);
  const canApprove = role === "owner" || role === "admin";
  const canReply = canApprove || role === "sales";
  const items = chronological(thread.items);

  useEffect(() => {
    alive.current = true;
    // what was new is now read
    if (thread.items.some((i) => i.direction === "in")) void actions.markRead();
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const r = await actions.refresh();
      if (alive.current && r.ok) setThread(r.data);
    }, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function again() {
    const r = await actions.refresh();
    if (r.ok) setThread(r.data);
  }
  function resultSentence(r: ReplyResult): string {
    if (r.status === "sent") return t("wa.said.sent");
    if (r.status === "queued") return t(r.reason === "quiet_hours" ? "wa.said.held" : "wa.said.queued");
    if (r.status === "needs_approval") return t("wa.said.waiting");
    return t("wa.said.blocked", { why: (words[`outbox.reason.${r.reason}`] ?? t("wa.derr.other_error")) });
  }
  async function send() {
    if (text.trim() === "") return;
    setBusy("reply");
    setFailure(null);
    setSaid(null);
    const r = await actions.reply(crypto.randomUUID(), text.trim(), language);
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setText("");
    setSaid(resultSentence(r.data));
    await again();
  }
  async function decide(messageId: string, what: "approve" | "reject") {
    setBusy(messageId);
    setFailure(null);
    setSaid(null);
    const r = await (what === "approve" ? actions.approve(messageId) : actions.reject(messageId));
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setSaid(what === "approve" ? resultSentence(r.data) : t("wa.said.declined"));
    await again();
  }

  return (
    <div className="flex flex-col gap-4" data-chat="thread">
      {thread.stopped ? (
        <p role="note" className="rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
          {t("wa.note.stopped")}
        </p>
      ) : thread.whatsapp_consent === "withdrawn" ? (
        <p role="note" className="rounded-lg border border-red-text bg-red-bg px-3 py-2 text-base font-medium text-red-text">
          {t("wa.note.withdrawn")}
        </p>
      ) : !thread.window_open ? (
        <p role="note" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-base font-medium text-amber-text">
          {t("wa.note.window")}
        </p>
      ) : null}
      {quietHours ? (
        <p role="note" className="rounded-lg border border-line bg-info-bg px-3 py-2 text-sm font-medium text-info-text" data-quiet-note="">
          {t("wa.note.quiet", { start: hourWord(quietHours.start), end: hourWord(quietHours.end) })}
        </p>
      ) : null}

      <section className={card} aria-labelledby={`${id}-msgs`}>
        <h2 id={`${id}-msgs`} className="sr-only">
          {t("wa.thread.messages")}
        </h2>
        {thread.next_before ? <p className={help}>{t("wa.thread.latest")}</p> : null}
        {items.length === 0 ? <p className="text-base text-muted">{t("wa.thread.none")}</p> : null}
        <ol className="flex flex-col gap-3">
          {items.map((m) => (
            <Message key={`${m.direction}-${m.id}`} m={m} t={t} words={words} now={now} canApprove={canApprove} busy={busy} onDecide={decide} />
          ))}
        </ol>
        <div>
          <button type="button" onClick={again} className={quiet}>
            {t("wa.thread.refresh")}
          </button>
        </div>
      </section>

      {canReply ? (
        <section className={card} aria-labelledby={`${id}-reply`}>
          <h2 id={`${id}-reply`} className={h2}>
            {t("wa.reply.title")}
          </h2>
          {!thread.window_open ? <p className={help}>{t("wa.reply.window")}</p> : null}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div>
              <label htmlFor={`${id}-text`} className={labelClass}>
                {t("wa.reply.text")}
              </label>
              <textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} className={`${field} py-2`} />
            </div>
            <div className="max-w-60">
              <label htmlFor={`${id}-lang`} className={labelClass}>
                {t("wa.reply.language")}
              </label>
              <select id={`${id}-lang`} value={language} onChange={(e) => setLanguage(e.target.value)} className={selectClass}>
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {t(`today.lang.${l}`)}
                  </option>
                ))}
              </select>
            </div>
            <p className={help}>{t("wa.reply.rules")}</p>
            <FailureNote failure={failure} words={words} />
            {said ? (
              <p role="status" className={okLine}>
                {said}
              </p>
            ) : null}
            <div>
              <button type="submit" disabled={busy !== null || text.trim() === ""} className={primary}>
                {busy === "reply" ? t("dta.btn.working") : t("wa.reply.send")}
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {!canReply ? <FailureNote failure={failure} words={words} /> : null}
    </div>
  );
}

function Message({ m, t, words, now, canApprove, busy, onDecide }: { m: ThreadItem; t: Say; words: Words; now: number; canApprove: boolean; busy: string | null; onDecide: (id: string, what: "approve" | "reject") => void }) {
  const mine = m.direction === "out";
  const state = mine ? outState(m) : null;
  const why = mine && (state === "blocked" || state === "waiting" || state === "queued") && m.reason ? words[`outbox.reason.${m.reason}`] : null;
  const bad = mine ? failureWord(m, t) : null;
  void now;
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`} data-direction={m.direction}>
      <div className={`max-w-[85%] rounded-2xl border px-3 py-2 text-base ${mine ? "border-brand-edge bg-brand-bg text-ink" : "border-line bg-surface-2 text-ink"}`}>
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
        {m.photos > 0 ? <p className="mt-1 text-sm text-muted">{t("wa.thread.photos", { n: m.photos })}</p> : null}
      </div>
      <div className={`flex max-w-[85%] flex-wrap items-center gap-2 text-sm text-muted ${mine ? "justify-end" : ""}`}>
        <span>
          {indiaDay(m.at).slice(5)} {indiaClock(m.at)}
        </span>
        {mine && state ? <span className={pillClass(OUT_TONE[state])}>{t(`wa.out.${state}`)}</span> : null}
      </div>
      {why ? <p className="max-w-[85%] text-sm text-muted">{why}</p> : null}
      {bad ? <p className="max-w-[85%] text-sm font-medium text-red-text">{bad}</p> : null}
      {mine && state === "waiting" && canApprove ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onDecide(m.id, "approve")} disabled={busy !== null} className={primary}>
            {busy === m.id ? t("dta.btn.working") : t("wa.out.approve")}
          </button>
          <button type="button" onClick={() => onDecide(m.id, "reject")} disabled={busy !== null} className={danger}>
            {t("wa.out.decline")}
          </button>
        </div>
      ) : null}
    </li>
  );
}
