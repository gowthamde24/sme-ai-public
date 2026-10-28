"use client";

import { Copy, Mic, Plus, Send, Square, X } from "lucide-react";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { makeT } from "../../words";
import type { BrowserVoice } from "./browser-voice";
import { Drafts, ERROR_WORD, Sources } from "./AskView";
import { MarkdownLite } from "./MarkdownLite";
import { MAX_QUESTION } from "./ask-constants";
import type { AskSession, Exchange } from "./use-ask-session";
import { usePanelVoice, type PanelVoiceOptions } from "./use-panel-voice";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const bubble = "max-w-[92%] rounded-2xl px-3.5 py-2.5";

/** One exchange of the thread: what the person said or typed, then the answer (light formatting, a copy button, sources, drafts, the reason when it failed). */
function ExchangeView({ x, w, c, onEdit }: { x: Exchange; w: (k: string) => string; c: (k: string) => string; onEdit: (text: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(x.answer).then(() => setCopied(true), () => undefined);
  };
  return (
    <li data-chat="exchange" className="flex flex-col gap-2">
      {x.asked ? (
        <div data-chat="you" className={`${bubble} self-end border border-line bg-surface`}>
          <p className="text-base [overflow-wrap:anywhere]">{x.asked}</p>
          {x.heardByVoice ? (
            <button type="button" data-chat="edit" onClick={() => onEdit(x.asked)} className="mt-1 text-xs font-semibold text-brand-text underline underline-offset-2">
              {c("bv.chat.edit")}
            </button>
          ) : null}
        </div>
      ) : null}
      {x.answer ? (
        <div data-chat="assistant" className={`${bubble} self-start bg-surface-2`}>
          <MarkdownLite text={x.answer} />
          <button type="button" data-chat="copy" onClick={copy} aria-label={c("bv.chat.copy")} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
            <Copy className="size-3.5" aria-hidden="true" />
            {copied ? c("bv.chat.copied") : c("bv.chat.copy")}
          </button>
          <Sources sources={x.sources} w={w} />
          <Drafts drafts={x.drafts} w={w} />
        </div>
      ) : null}
      {x.failed && !x.answer ? <p role="alert" className="self-start text-base font-medium text-red-text">{x.errorCode !== null && ERROR_WORD[x.errorCode] ? w(ERROR_WORD[x.errorCode]) : w("ask.error")}</p> : null}
    </li>
  );
}

/**
 * The conversation panel (owner, 28 Oct): a small chat in its place, never full screen: a bubble above the floating circle on a laptop (about 380 by 560), a bottom sheet of about 60 % on a phone with the page still visible behind. ONE line to write in
 * (no Ask or Do it buttons: the assistant decides what a message is), the microphone beside it, and one thread for the typed and the spoken turns, each message with its copy button and light formatting. While the person speaks their words show LIVE, word by word, and
 * can be edited if misheard; the reply streams in as text below while it is spoken; a tap while it talks stops it. "New conversation" empties the thread. The floating circle shows what it is doing (listening, thinking, speaking).
 */
export function ChatPanel({ session, chips, voice, onClose, voiceOptions }: { session: AskSession; chips: readonly string[]; voice: BrowserVoice; onClose: () => void; voiceOptions?: PanelVoiceOptions }) {
  const s = session;
  const c = React.useMemo(() => {
    const t = makeT(voice.words);
    return (k: string) => t(k as "bv.chat.new");
  }, [voice.words]);
  const talk = usePanelVoice(s, voice, voiceOptions);
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const { w } = s;
  const current: Exchange | null = s.phase !== "idle" ? { asked: s.asked, heardByVoice: s.heardByVoice, answer: s.answer, sources: s.sources, drafts: s.drafts, errorCode: s.errorCode, failed: s.phase === "error", task: null } : null;
  const empty = s.earlier.length === 0 && current === null && !talk.live;
  React.useEffect(() => {
    input.current?.focus();
  }, []);
  React.useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [s.earlier.length, s.answer, talk.live?.answer, talk.live?.asked]);
  const edit = (text: string) => {
    s.setText(text);
    input.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      talk.stop();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const orb = talk.active ? (talk.state === "listening" ? "listen" : talk.state === "speaking" ? "speak" : "think") : s.asking && !s.answer ? "think" : s.asking ? "speak" : "ambient";
  const line = talk.state === "thinking" ? (talk.step === "looking" ? voice.words["bv.looking"] : voice.words["bv.thinking"]) : talk.state === "speaking" ? voice.words["bv.speaking"] : talk.state === "listening" ? voice.words["bv.listening"] : talk.active ? voice.words["bv.connecting"] : null;
  return (
    <div className="fixed inset-0 z-[55] print:hidden" data-chat="root">
      {/* the page stays visible and usable behind: the root does not catch the pointer, only the panel does */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="false"
        aria-label={c("bv.chat.title")}
        data-chat="panel"
        onKeyDown={onKeyDown}
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-[60dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-bg shadow-[var(--v2-shadow-pop)] motion-safe:animate-[ask-panel-in_160ms_ease-out] md:inset-x-auto md:bottom-28 md:right-4 md:h-[560px] md:max-h-[calc(100dvh-8rem)] md:w-[380px] md:rounded-2xl"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <Orb px={28} state={orb} analyser={talk.active ? talk.analyser(talk.state === "speaking" ? "voice" : "mic") : null} />
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{c("bv.chat.title")}</h2>
          <button type="button" data-chat="new" onClick={() => { talk.stop(); s.newChat(); }} aria-label={c("bv.chat.new")} title={c("bv.chat.new")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2">
            <Plus className="size-5" aria-hidden="true" />
          </button>
          <button type="button" data-chat="close" onClick={() => { talk.stop(); onClose(); }} aria-label={c("bv.close")} title={c("bv.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-chat="body" aria-live="polite">
          {empty ? <p className="text-sm text-muted">{c("bv.chat.empty")}</p> : null}
          <ul data-chat="thread" className="flex flex-col gap-4">
            {s.earlier.map((x, i) => (
              <ExchangeView key={i} x={x} w={w} c={c} onEdit={edit} />
            ))}
            {current ? <ExchangeView x={current} w={w} c={c} onEdit={edit} /> : null}
            {talk.live ? (
              <li data-chat="live" className="flex flex-col gap-2">
                {talk.live.asked ? (
                  <div data-chat="you-live" className={`${bubble} self-end border border-dashed border-line bg-surface ${talk.interim ? "opacity-70" : ""}`}>
                    <p className="text-base [overflow-wrap:anywhere]">{talk.live.asked}</p>
                  </div>
                ) : null}
                {talk.live.answer ? (
                  <div data-chat="assistant-live" className={`${bubble} self-start bg-surface-2`}>
                    <MarkdownLite text={talk.live.answer} />
                  </div>
                ) : null}
              </li>
            ) : null}
          </ul>
          {s.asking && !s.answer ? <p role="status" className="mt-2 text-sm text-muted">{c("bv.chat.working")}</p> : null}
          <div ref={end} />
        </div>
        <div className="shrink-0 space-y-2 border-t border-line bg-surface px-3 pb-3 pt-2">
          {empty && chips.length > 0 ? (
            <ul data-chat="chips" className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip}>
                  <button type="button" data-write onClick={() => void s.ask(chip)} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2">
                    {chip}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {line ? <p data-chat="state" role="status" className="text-sm font-medium text-muted">{line}</p> : null}
          {talk.micDenied ? <p role="alert" className="text-sm font-medium text-red-text">{voice.words["bv.mic.denied"]}</p> : null}
          {talk.end && !talk.active ? <p role="status" className="text-sm text-muted">{voice.words[`bv.end.${talk.end}`]}</p> : null}
          <form
            data-write
            data-chat="form"
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void s.ask(s.text);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              {c("bv.chat.placeholder")}
            </label>
            <input
              id="chat-input"
              ref={input}
              value={talk.interim !== "" ? talk.interim : s.text}
              readOnly={talk.interim !== ""}
              maxLength={MAX_QUESTION}
              onChange={(e) => s.setText(e.target.value)}
              placeholder={c("bv.chat.placeholder")}
              autoComplete="off"
              className="min-h-12 min-w-0 flex-1 rounded-full border border-edge bg-surface px-4 text-base text-ink placeholder:text-muted focus:border-brand-edge"
            />
            {talk.state === "speaking" ? (
              <button type="button" data-chat="stop-talk" onClick={talk.bargeIn} aria-label={c("bv.chat.stop")} title={c("bv.chat.stop")} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-brand-edge bg-brand text-on-brand">
                <Square className="size-5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                data-chat="mic"
                aria-pressed={talk.active}
                onClick={() => (talk.active ? talk.stop() : void talk.start())}
                aria-label={talk.active ? c("bv.chat.micstop") : c("bv.chat.mic")}
                title={talk.active ? c("bv.chat.micstop") : c("bv.chat.mic")}
                className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full border ${talk.active ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}
              >
                {talk.active ? <Square className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
              </button>
            )}
            {s.asking ? (
              <button type="button" onClick={s.stop} aria-label={w("ask.stop")} title={w("ask.stop")} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-ink hover:bg-surface-2">
                <Square className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" disabled={s.text.trim() === ""} aria-label={c("bv.chat.send")} title={c("bv.chat.send")} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-brand-edge bg-brand text-on-brand disabled:opacity-50">
                <Send className="size-5" aria-hidden="true" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
