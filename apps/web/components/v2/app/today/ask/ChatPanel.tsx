"use client";

import { ArrowUp, ChevronDown, ChevronUp, Copy, History, Mic, Plus, Square, X } from "lucide-react";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { makeT } from "../../words";
import type { VoiceLang } from "@/lib/browser-voice/protocol";
import type { BrowserVoice } from "./browser-voice";
import { Drafts, ERROR_WORD, Sources } from "./AskView";
import { MarkdownLite } from "./MarkdownLite";
import { useChatLanguage } from "./chat-language";
import { saveChatLanguage } from "./chat-language-post";
import { LanguagePill } from "./LanguagePill";
import { LiveStatus } from "./LiveStatus";
import { Mispronounced } from "./Mispronounced";
import { useRingLevel } from "./ring-level";
import { MAX_QUESTION } from "./ask-constants";
import type { AskSession, Exchange } from "./use-ask-session";
import { archiveHistory, confirmPlan, listHistory, openHistory, type ConversationItem } from "./conversation-api";
import { usePanelVoice, type PanelVoiceOptions } from "./use-panel-voice";
import { useDictation } from "./use-dictation";
import { useKeyboardInset } from "./use-keyboard-inset";
import type { ConfirmAction } from "@/lib/api/turns";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const bubble = "max-w-[92%] rounded-2xl px-3.5 py-2.5";
/** How a chat can end without a word on the screen: it went quiet, hit its time limit or was closed. The panel stays as it was (typing works; the microphone starts a new chat without a greeting). The other ends say why. */
const QUIET_ENDS: readonly string[] = ["idle", "session", "left", "goodbye"];
/** What a microphone problem of dictation says (the route's own codes are in ERROR_WORD). */
const PROBLEM_WORDS: Readonly<Record<string, string>> = { denied: "ask.mic.denied", nomic: "ask.voice.nomic", short: "ask.voice.short", unsupported: "ask.mic.failed", failed: "ask.mic.failed" };

/** One exchange of the thread: what the person said or typed, then the answer (light formatting, a copy button, sources, drafts, the reason when it failed). */
/** The plan the router proposed: what it will do, for whom, how (and about how much), and ONE tap: Yes, do it / No. Once answered (or expired) it shows its state in words. */
function PlanCard({ plan, c, base, onStatus }: { plan: ConfirmAction; c: (k: string) => string; base: string; onStatus: (id: string, status: ConfirmAction["status"]) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const decide = async (decision: "yes" | "no") => {
    setBusy(true);
    setProblem(null);
    const out = await confirmPlan(base, plan.actionId, decision);
    setBusy(false);
    if (out.ok) onStatus(plan.actionId, out.status);
    else if (out.error === "expired") onStatus(plan.actionId, "expired");
    else setProblem(out.error === "mfa" ? "bv.chat.err.mfa" : out.error === "forbidden" ? "bv.chat.err.forbidden" : out.error === "state" ? "bv.chat.state.done" : "bv.chat.err.down");
  };
  const facts = [plan.count !== null ? c("bv.chat.plan.people").replace("{n}", String(plan.count)) : null, plan.estimate ? c("bv.chat.plan.messages").replace("{n}", String(plan.estimate.messages)) : null, plan.estimate && plan.estimate.callMinutes > 0 ? c("bv.chat.plan.minutes").replace("{n}", String(plan.estimate.callMinutes)) : null, plan.channel ? c(`bv.chat.plan.${plan.channel}`) : null].filter((v): v is string => v !== null);
  return (
    <article data-chat="plan" aria-label={c("bv.chat.plan")} className="mt-2 rounded-xl border border-brand-edge bg-surface p-3">
      <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{plan.title}</h3>
      {plan.summary ? <p className="mt-1 text-sm [overflow-wrap:anywhere]">{plan.summary}</p> : null}
      {plan.steps.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
          {plan.steps.map((st, i) => (
            <li key={i}>{st}</li>
          ))}
        </ol>
      ) : null}
      {facts.length > 0 ? <p className="mt-2 text-sm text-muted">{facts.join(" · ")}</p> : null}
      {plan.status === "proposed" ? (
        <div className="mt-3 flex gap-2">
          <button type="button" data-chat="yes" data-write disabled={busy} onClick={() => void decide("yes")} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-brand-edge bg-brand px-4 text-base font-semibold text-on-brand disabled:opacity-60">
            {c("bv.chat.yes")}
          </button>
          <button type="button" data-chat="no" data-write disabled={busy} onClick={() => void decide("no")} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-edge bg-surface px-4 text-base font-semibold text-ink disabled:opacity-60">
            {c("bv.chat.no")}
          </button>
        </div>
      ) : (
        <p data-chat="plan-state" className="mt-2 text-sm font-semibold">{c(`bv.chat.state.${plan.status}`)}</p>
      )}
      {problem ? <p role="alert" className="mt-2 text-sm font-medium text-red-text">{c(problem)}</p> : null}
    </article>
  );
}

function ExchangeView({ x, w, c, onEdit, base, onStatus, mis, onRetry }: { /** The way to ask the same question again, for the exchange that is on screen and failed. */ onRetry?: (() => void) | undefined; mis: { endpoint: string; language: VoiceLang } | null; x: Exchange; w: (k: string) => string; c: (k: string) => string; onEdit: (text: string) => void; base: string; onStatus: (id: string, status: ConfirmAction["status"]) => void }) {
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
          {x.interrupted ? <p data-chat="interrupted" className="mt-1 text-xs font-semibold text-muted">{c("bv.live.interrupted")}</p> : null}
          <button type="button" data-chat="copy" onClick={copy} aria-label={c("bv.chat.copy")} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
            <Copy className="size-3.5" aria-hidden="true" />
            {copied ? c("bv.chat.copied") : c("bv.chat.copy")}
          </button>
          {mis && x.heardByVoice ? <Mispronounced text={x.answer} language={mis.language} endpoint={mis.endpoint} c={c} /> : null}
          <Sources sources={x.sources} w={w} />
          <Drafts drafts={x.drafts} w={w} />
        </div>
      ) : null}
      {x.plan ? (
        <div className={`${bubble} self-start bg-surface-2`}>
          <PlanCard plan={x.plan} c={c} base={base} onStatus={onStatus} />
        </div>
      ) : null}
      {x.failed && !x.answer ? (
        <div className="flex flex-wrap items-center gap-x-3 self-start">
          <p role="alert" data-chat="failed" className="text-base font-medium text-red-text">{x.errorCode !== null && ERROR_WORD[x.errorCode] ? w(ERROR_WORD[x.errorCode]) : x.task ? w("ask.error") : w("ask.sorry")}</p>
          {onRetry ? (
            <button type="button" data-chat="retry" onClick={onRetry} className="inline-flex min-h-11 items-center rounded-full px-3 text-base font-semibold text-brand-text hover:bg-surface-2">
              {w("ask.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The conversation panel (owner, 28 Oct): a small chat in its place, never full screen: a bubble above the floating circle on a laptop (about 380 by 560), a bottom sheet of about 60 % on a phone with the page still visible behind. ONE line to write in
 * (no Ask or Do it buttons: the assistant decides what a message is), the microphone beside it, and one thread for the typed and the spoken turns, each message with its copy button and light formatting. While the person speaks their words show LIVE, word by word, and
 * can be edited if misheard; the reply streams in as text below while it is spoken; a tap while it talks stops it. "New conversation" empties the thread. The floating circle shows what it is doing (listening, thinking, speaking).
 */
export function ChatPanel({ session, chips, voice, onClose, voiceOptions, variant = "panel" }: { session: AskSession; chips: readonly string[]; voice: BrowserVoice; onClose: () => void; voiceOptions?: PanelVoiceOptions; /** `card`: the same chat drawn inside Today's assistant card, in its place (no close button, no focus trap). */ /** `bar`: Today's command bar on a desktop: the orb, one line to write in with the buttons, and the chips in ONE row; the conversation opens below it (about half the screen at most, scrolling inside) with a Minimise button. */ variant?: "panel" | "card" | "bar" }) {
  const s = session;
  const c = React.useMemo(() => {
    const t = makeT(voice.words);
    return (k: string) => t(k as "bv.chat.new");
  }, [voice.words]);
  const rememberLanguage = React.useCallback((l: string) => void (voice.chatLanguageUrl ? saveChatLanguage(voice.chatLanguageUrl, l) : undefined), [voice.chatLanguageUrl]);
  const chat = useChatLanguage(voice.language, voice.chatLanguage ?? null, rememberLanguage); // the language pill: Auto or one language, remembered (in the profile, and in this browser)
  const talk = usePanelVoice(s, voice, voiceOptions, chat);
  const dict = useDictation(s, voice, voiceOptions, chat);
  const [plusOpen, setPlusOpen] = React.useState(false); // the "+" menu of the command bar
  const [view, setView] = React.useState<"chat" | "history">("chat");
  const [items, setItems] = React.useState<ConversationItem[] | "error" | null>(null);
  const showHistory = async () => {
    setView("history");
    setItems(null);
    setItems((await listHistory(s.base)) ?? "error");
  };
  const reopen = async (id: string) => {
    const thread = await openHistory(s.base, id);
    if (thread === null) return setItems("error");
    talk.stop();
    s.newChat(id, thread);
    setView("chat");
  };
  const hide = async (id: string) => {
    if (await archiveHistory(s.base, id)) setItems((list) => (Array.isArray(list) ? list.filter((x) => x.id !== id) : list));
  };
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const { w } = s;
  // "Mispronounced?" under spoken messages: the Owner and Admin teach the words through the pronunciation route
  const mis = voice.pronunciation ? { endpoint: `${s.base}/pronunciation`, language: voice.language } : null;
  const current: Exchange | null = s.phase !== "idle" ? { asked: s.asked, heardByVoice: s.heardByVoice, answer: s.answer, sources: s.sources, drafts: s.drafts, errorCode: s.errorCode, failed: s.phase === "error", task: null, plan: s.plan } : null;
  const dictating = dict.state !== "idle";
  const empty = s.earlier.length === 0 && current === null && !talk.live;
  const bar = variant === "bar";
  // the command bar: the conversation below it can be minimised; it opens again by itself when something new happens (a message, an answer, Live talk starting)
  const version = s.earlier.length * 4 + (s.asking ? 1 : 0) + (talk.active ? 2 : 0);
  const [minAt, setMinAt] = React.useState<number | null>(null);
  const minimised = bar && minAt === version;
  const btn = "size-10";
  React.useEffect(() => {
    if (!plusOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest?.('[data-chat="plus"], [data-chat="plus-menu"]')) setPlusOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [plusOpen]);
  React.useEffect(() => {
    if (variant === "panel") input.current?.focus();
  }, [variant]);
  React.useEffect(() => {
    const el = body.current; // the thread scrolls inside its own box (scrollIntoView would move the whole page when the chat sits in a card)
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.earlier.length, s.answer, talk.live?.answer, talk.live?.asked, talk.state]);
  // the box grows with what is typed (one line when empty, about five at most, then it scrolls inside) and shrinks again after Send
  React.useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = s.text === "" ? "" : `${el.scrollHeight}px`; // empty = one line, whatever the length of the placeholder; the class max-h caps the rest
  }, [s.text]);
  // on a phone the keyboard covers the bottom of the page: the panel sits above it, and the thread keeps its last message in view
  useKeyboardInset(box, variant === "panel", () => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  /** The state of a plan changed (the owner said yes or no, or it expired): the plan on screen and any earlier message that carries it. */
  const setActionStatus = (actionId: string, status: ConfirmAction["status"]) => {
    s.setPlan((p) => (p && p.actionId === actionId ? { ...p, status } : p));
    s.setEarlier((list) => list.map((x) => (x.plan && x.plan.actionId === actionId ? { ...x, plan: { ...x.plan, status } } : x)));
  };
  const edit = (text: string) => {
    s.setText(text);
    input.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (variant !== "panel") return talk.stop();
      e.stopPropagation();
      talk.stop();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !box.current || variant !== "panel") return;
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
  const orb = talk.active ? (talk.state === "listening" || talk.state === "paused" ? "listen" : talk.state === "speaking" ? "speak" : "think") : s.asking && !s.answer ? "think" : s.asking ? "speak" : "ambient";
  // under the circle while it speaks: which voice it is ("Speaking in Telugu · Ramya"), as the API says it at the start of the turn
  const said = talk.voice;
  const hint = talk.state === "speaking" && said?.name ? c("bv.speaking.in").replace("{language}", voice.languageNames[said.language ?? voice.language] ?? "").replace("{voice}", said.name) : null;
  const chipsEl = empty && chips.length > 0 ? (
            <ul data-chat="chips" className={`flex flex-wrap gap-2 ${bar ? "min-w-0" : ""}`}>
              {chips.map((chip) => (
                <li key={chip}>
                  <button type="button" data-write onClick={() => void s.ask(chip, chat.pill)} className={`inline-flex ${bar ? "min-h-9 px-3" : "min-h-10 px-3.5"} items-center rounded-full border border-edge bg-surface text-sm font-semibold text-ink hover:bg-surface-2`}>
                    {chip}
                  </button>
                </li>
              ))}
            </ul>
          ) : null;
  // the pieces of the bar (owner 31 Oct, design C): the language pill, the microphone (Dictate), Send and the prominent Talk button; the same pieces in the sheet on a phone
  const pillEl = <LanguagePill value={chat.pill} onChange={chat.set} label={c("bv.lang.label")} auto={c("bv.lang.auto")} />;
  const micEl = (
    <button
      type="button"
      data-chat="dictate"
      aria-pressed={dictating}
      disabled={talk.active || dict.state === "connecting"}
      onClick={dict.toggle}
      aria-label={dictating ? c("bv.chat.dictate.stop") : c("bv.chat.dictate")}
      title={dictating ? c("bv.chat.dictate.stop") : c("bv.chat.dictate")}
      className={`inline-flex ${btn} shrink-0 items-center justify-center rounded-full border disabled:opacity-50 ${dictating ? "border-brand-edge bg-brand text-on-brand" : "border-transparent bg-transparent text-ink hover:bg-surface-2"}`}
    >
      {dictating ? <Square className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
    </button>
  );
  const sendEl = s.asking ? (
    <button type="button" onClick={s.stop} aria-label={w("ask.stop")} title={w("ask.stop")} className={`inline-flex ${btn} shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-ink hover:bg-surface-2`}>
      <Square className="size-4" aria-hidden="true" />
    </button>
  ) : (
    <button type="submit" disabled={s.text.trim() === "" || dictating} aria-label={c("bv.chat.send")} title={c("bv.chat.send")} className={`inline-flex ${btn} shrink-0 items-center justify-center rounded-full border border-brand-edge bg-brand text-on-brand disabled:opacity-50`}>
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  );
  // the ring around the orb pulses with the sound: the microphone's while it listens, the voice's while it speaks
  const ringLevel = useRingLevel(talk.active && talk.state === "listening" ? talk.analyser("mic") : talk.active && talk.state === "speaking" ? talk.analyser("voice") : null);
  const caption = talk.connecting ? c("bv.connecting") : !talk.active ? c("bv.orb.tap") : talk.state === "speaking" ? c("bv.orb.speaking") : talk.state === "thinking" ? c("bv.thinking") : talk.state === "paused" ? c("bv.live.paused") : c("bv.listening");
  /* The orb IS the Talk button (owner 31 Oct): a hands-free spoken conversation; it listens again after every answer, you may speak over it, and a tap again (or about 30 s of silence) ends it. The ring around it is its voice: still when idle, pulsing with the sound while it listens or speaks. */
  const talkOrb = (px: number, withCaption: boolean) => (
    <div className={`flex shrink-0 flex-col items-center gap-1.5 ${withCaption ? "w-[84px]" : ""}`}>
      <button
        type="button"
        data-chat="live-talk"
        aria-pressed={talk.active}
        disabled={dictating}
        onClick={() => (talk.active ? talk.stop() : void talk.start())}
        aria-label={talk.active ? c("bv.chat.live.stop") : c("bv.chat.live.start")}
        title={talk.active ? c("bv.chat.live.stop") : c("bv.chat.live.start")}
        className="relative grid shrink-0 place-items-center rounded-full p-1 shadow-[var(--v2-shadow-pop)] disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          data-chat="ring"
          data-level={ringLevel}
          className={`pointer-events-none absolute inset-0 rounded-full border-2 transition-transform duration-100 ${talk.active ? "border-brand-edge" : "border-brand-edge/70"} ${talk.active && talk.state === "thinking" ? "motion-safe:animate-pulse" : ""} ${["scale-100", "scale-105", "scale-110", "scale-[1.16]"][ringLevel]}`}
        />
        <Orb px={px} state={orb} analyser={talk.active ? talk.analyser(talk.state === "speaking" ? "voice" : "mic") : null} />
      </button>
      {withCaption ? (
        <span data-chat="talk-caption" role="status" className="text-center text-xs font-semibold leading-tight text-muted">
          {caption}
        </span>
      ) : null}
    </div>
  );
  const plusEl = (
    <div className="relative shrink-0">
      <button type="button" data-chat="plus" aria-haspopup="menu" aria-expanded={plusOpen} aria-label={c("bv.bar.plus")} title={c("bv.bar.plus")} onClick={() => setPlusOpen((v) => !v)} className="inline-flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-2">
        <Plus className="size-5" aria-hidden="true" />
      </button>
      {plusOpen ? (
        <div role="menu" data-chat="plus-menu" className={`absolute left-0 z-20 flex min-w-56 flex-col rounded-xl border border-line bg-surface p-1 shadow-[var(--v2-shadow-pop)] ${bar ? "top-full mt-2" : "bottom-full mb-2"}`}>
          <button type="button" role="menuitem" data-chat="new" onClick={() => { setPlusOpen(false); talk.stop(); s.newChat(); setView("chat"); }} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-surface-2">
            <Plus className="size-4" aria-hidden="true" />
            {c("bv.chat.new")}
          </button>
          <button type="button" role="menuitem" data-chat="history" onClick={() => { setPlusOpen(false); void showHistory(); }} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-surface-2">
            <History className="size-4" aria-hidden="true" />
            {c("bv.chat.history")}
          </button>
        </div>
      ) : null}
    </div>
  );
  // the composer (owner 31 Oct, "composer + orb"): a rounded card with the text on top (it grows with what is typed) and the toolbar under it: plus, the language pill, a spacer, the microphone (Dictate) and Send
  const composerEl = (
    <form
      data-write
      data-chat="form"
      className="flex min-w-0 flex-col gap-1 rounded-[16px] border border-edge bg-surface p-2.5 focus-within:border-brand-edge"
      onSubmit={(e) => {
        e.preventDefault();
        void s.ask(s.text, chat.pill);
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        {c("bv.chat.placeholder")}
      </label>
      <textarea
        id="chat-input"
        ref={input}
        rows={1}
        value={s.text}
        maxLength={MAX_QUESTION}
        onChange={(e) => s.setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a new line; not while a keyboard is still composing a word (Telugu, Hindi, Kannada)
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={dictating ? c("bv.chat.dictating") : c("bv.bar.placeholder")}
        readOnly={dictating}
        autoComplete="off"
        enterKeyHint="send"
        className="block min-h-11 w-full min-w-0 max-h-40 resize-none overflow-y-auto bg-transparent px-1 py-2 text-base leading-6 text-ink outline-none placeholder:text-muted focus:outline-none focus-visible:outline-none"
      />
      <div data-chat="toolbar" className="flex items-center gap-1">
        {plusEl}
        {pillEl}
        <span aria-hidden="true" className="flex-1" />
        {micEl}
        {sendEl}
      </div>
    </form>
  );
  const statusEl = (
    <>
          {talk.active ? <LiveStatus talk={talk} c={c} /> : null}
        {dictating ? <p data-chat="dictating" role="status" className="text-sm font-medium text-muted">{c("bv.chat.dictating")}</p> : null}
        {dict.error ? <p data-chat="dictate-error" role="status" className="text-sm text-amber-text">{w(ERROR_WORD[dict.error] ?? PROBLEM_WORDS[dict.error] ?? "ask.mic.failed")}</p> : null}
        {talk.problem ? <p data-chat="live-problem" role="status" className="text-sm text-amber-text">{w(ERROR_WORD[talk.problem] ?? "ask.error")}</p> : null}
        {talk.micDenied ? <p role="alert" className="text-sm font-medium text-red-text">{voice.words["bv.mic.denied"]}</p> : null}
        {talk.end && !talk.active && !QUIET_ENDS.includes(talk.end) ? <p role="status" className="text-sm text-muted">{voice.words[`bv.end.${talk.end}`]}</p> : null}
        {talk.micDenied || talk.problem || dict.error || (talk.end && !talk.active && !QUIET_ENDS.includes(talk.end)) ? (
          <button type="button" data-chat="type-instead" onClick={() => input.current?.focus()} className="min-h-9 rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2">
            {c("bv.live.typeinstead")}
          </button>
        ) : null}

    </>
  );
  const historyEl = (
          <div className={`overflow-y-auto px-3 py-3 ${bar ? `order-3 max-h-[50vh] rounded-b-2xl border border-t-0 border-line bg-surface ${minimised ? "hidden" : ""}` : "min-h-0 flex-1"}`} data-chat="history-list">
            <button type="button" data-chat="history-back" onClick={() => setView("chat")} className="mb-3 inline-flex min-h-10 items-center text-sm font-semibold text-brand-text underline underline-offset-2">
              {c("bv.chat.history.back")}
            </button>
            {items === null ? <p role="status" className="text-sm text-muted">{c("bv.chat.working")}</p> : null}
            {items === "error" ? <p role="alert" className="text-sm font-medium text-red-text">{c("bv.chat.history.err")}</p> : null}
            {Array.isArray(items) && items.length === 0 ? <p className="text-sm text-muted">{c("bv.chat.history.empty")}</p> : null}
            {Array.isArray(items) ? (
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <li key={it.id} className="flex items-stretch gap-2">
                    <button type="button" data-chat="history-item" onClick={() => void reopen(it.id)} className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-3 text-left hover:bg-surface-2">
                      <span className="block truncate text-base font-semibold">{it.title || it.lastText}</span>
                      <span className="block truncate text-sm text-muted">{it.lastText}</span>
                    </button>
                    <button type="button" data-chat="history-hide" onClick={() => void hide(it.id)} className="shrink-0 rounded-xl px-2 text-xs font-semibold text-muted hover:text-ink">
                      {c("bv.chat.history.archive")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
  );
  const bodyEl = (
        <div ref={body} className={`overflow-y-auto px-3 py-3 ${bar ? `order-3 max-h-[50vh] rounded-b-2xl border border-t-0 border-line bg-surface ${empty || minimised ? "hidden" : ""}` : "min-h-0 flex-1"}`} data-chat="body" aria-live="polite">
          {empty ? (
            <div data-chat="empty" className="flex flex-col gap-3">
              <p className="text-sm text-muted">{c("bv.chat.empty")}</p>
              {bar ? null : chipsEl}
            </div>
          ) : null}
          <ul data-chat="thread" className="flex flex-col gap-4">
            {s.earlier.map((x, i) => (
              <ExchangeView key={i} x={x} w={w} c={c} onEdit={edit} base={s.base} onStatus={setActionStatus} mis={mis} />
            ))}
            {current ? <ExchangeView x={current} w={w} c={c} onEdit={edit} base={s.base} onStatus={setActionStatus} mis={mis} onRetry={current.failed && !current.answer && !current.heardByVoice && current.asked !== "" && !current.task ? s.retry : undefined} /> : null}
            {talk.state === "listening" && !talk.live?.asked ? (
              <li data-chat="wave" aria-hidden="true" className={`${bubble} flex h-11 items-center gap-1 self-end border border-dashed border-brand-edge bg-surface`}>
                {["", "[animation-delay:120ms]", "[animation-delay:240ms]", "[animation-delay:360ms]", "[animation-delay:480ms]"].map((delay) => (
                  <span key={delay} className={`h-5 w-1 origin-center rounded-full bg-brand motion-safe:animate-pulse ${delay}`} />
                ))}
              </li>
            ) : null}
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
                    {talk.live.cut ? <p data-chat="interrupted" className="mt-1 text-xs font-semibold text-muted">{c("bv.live.interrupted")}</p> : null}
                    {mis ? <Mispronounced text={talk.live.answer} language={mis.language} endpoint={mis.endpoint} c={c} /> : null}
                  </div>
                ) : null}
              </li>
            ) : null}
          </ul>
          {s.asking && !s.answer ? <p role="status" className="mt-2 text-sm text-muted">{c("bv.chat.working")}</p> : null}
        </div>
  );
  // the conversation's header: who it is and how it speaks ("Your assistant · speaking in Telugu · Ramya"), the history, a new conversation, Minimise
  const speakingIn = c("bv.bar.speakingin").replace("{language}", voice.languageNames[chat.reply] ?? "");
  const convHeader = (
    <div className={`order-2 flex min-h-11 shrink-0 items-center gap-2 border bg-surface px-3 ${minimised ? "rounded-2xl" : "rounded-t-2xl border-b-0"} border-line ${empty && view === "chat" ? "hidden" : ""}`}>
      <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold">
        {c("bv.chat.title")}
        <span data-chat="speaking-in" className="font-sans text-sm font-normal text-muted">
          {" · "}
          {speakingIn}
          {talk.voice?.name ? ` · ${talk.voice.name}` : ""}
        </span>
      </h2>
      <button type="button" data-chat="history" onClick={() => void showHistory()} aria-label={c("bv.chat.history")} title={c("bv.chat.history")} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full hover:bg-surface-2">
        <History className="size-5" aria-hidden="true" />
      </button>
      <button type="button" data-chat="new" onClick={() => { talk.stop(); s.newChat(); setView("chat"); }} aria-label={c("bv.chat.new")} title={c("bv.chat.new")} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full hover:bg-surface-2">
        <Plus className="size-5" aria-hidden="true" />
      </button>
      <button type="button" data-chat="minimise" aria-expanded={!minimised} onClick={() => setMinAt(minimised ? null : version)} className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink">
        {minimised ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronUp className="size-4" aria-hidden="true" />}
        {minimised ? c("bv.bar.show") : c("bv.bar.minimise")}
      </button>
    </div>
  );
  // the panel's header (the floating orb's bubble and the phone's sheet): the orb at the top IS the Talk button, with its title and what it is doing
  const panelHeader = (
    <div className="flex min-h-16 shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      {talkOrb(48, false)}
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-lg font-semibold">{c("bv.chat.title")}</h2>
        <p data-chat={hint ? "speaking-in" : "talk-caption"} role="status" className="truncate text-xs font-semibold text-muted">
          {hint ?? caption}
        </p>
      </div>
      <button type="button" data-chat="history" onClick={() => void showHistory()} aria-label={c("bv.chat.history")} title={c("bv.chat.history")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2">
        <History className="size-5" aria-hidden="true" />
      </button>
      <button type="button" data-chat="new" onClick={() => { talk.stop(); s.newChat(); setView("chat"); }} aria-label={c("bv.chat.new")} title={c("bv.chat.new")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2">
        <Plus className="size-5" aria-hidden="true" />
      </button>
      {variant === "panel" ? (
        <button type="button" data-chat="close" onClick={() => { talk.stop(); onClose(); }} aria-label={c("bv.close")} title={c("bv.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-surface-2">
          <X className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
  const content = (
    <>
      {panelHeader}
      {view === "history" ? historyEl : bodyEl}
      <div className="shrink-0 space-y-2 border-t border-line bg-surface px-3 pb-3 pt-2">
        {statusEl}
        {composerEl}
      </div>
    </>
  );
  return variant === "bar" ? (
    <div ref={box} role="region" aria-label={c("bv.chat.title")} data-chat="bar" onKeyDown={onKeyDown} className="flex items-start gap-4">
      {talkOrb(64, true)}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {composerEl}
        {chipsEl}
        {statusEl}
        {convHeader}
        {view === "history" ? historyEl : bodyEl}
      </div>
    </div>
  ) : variant === "card" ? (
    <div ref={box} role="region" aria-label={c("bv.chat.title")} data-chat="card" onKeyDown={onKeyDown} className="flex h-[min(70dvh,34rem)] min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-bg">
      {content}
    </div>
  ) : (
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
        className="pointer-events-auto absolute inset-x-0 bottom-[var(--kb,0px)] flex max-h-[min(560px,calc(var(--vvh,100dvh)-0.5rem))] flex-col rounded-t-2xl border border-line bg-bg shadow-[var(--v2-shadow-pop)] motion-safe:animate-[ask-panel-in_160ms_ease-out] md:inset-x-auto md:bottom-28 md:right-4 md:max-h-[min(560px,calc(100dvh-8rem))] md:w-[440px] md:rounded-2xl"
      >
        {content}
      </div>
    </div>
  );
}
