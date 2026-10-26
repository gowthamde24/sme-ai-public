"use client";

import { ArrowRight, Mic, Send, Square, Volume2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { clock } from "./recorder";
import { useFollowAnswer } from "./use-follow-answer";
import { MAX_QUESTION } from "./ask-constants";
import type { AskSession, Exchange } from "./use-ask-session";
import { VoiceMode } from "./VoiceMode";
import type { RecorderProblem } from "./use-recorder";

const chipClass = "inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50";
const KIND_WORD: Readonly<Record<string, string>> = { quote: "today.kind.quote", followup_draft: "today.kind.followup", reply_draft: "ask.kind.reply", enquiry: "ask.kind.enquiry", store_visit: "ask.kind.visit" };
const PROBLEM_WORD: Readonly<Record<RecorderProblem, string>> = { denied: "ask.mic.denied", nomic: "ask.voice.nomic", short: "ask.voice.short", unsupported: "ask.mic.failed", failed: "ask.mic.failed" };
/** What a failed answer says, by the code the route gave (typed and spoken questions share the first six). */
const ERROR_WORD: Readonly<Record<string, string>> = {
  ai_paused_until: "ask.err.cost", run_limit_reached: "ask.err.limit", forbidden: "ask.err.role", agents_disabled: "office.switchedoff", model_busy: "ask.err.busy", model_not_configured: "ask.err.notset",
  voice_too_long: "ask.voice.toolong", voice_too_short: "ask.voice.short", voice_no_speech: "ask.mic.silent", voice_unavailable: "ask.voice.err.unavailable", voice_failed: "ask.voice.err.failed", network: "ask.voice.err.network",
};

/** Where the question is asked: `card` is Today's assistant card, `panel` the floating panel of the other screens, `box` the plain card of the Ask box (and of its tests). */
export type AskLook = "card" | "panel" | "box";

/**
 * The question line: a text box, the microphone and Send (or Stop while an answer is coming, or the recording's countdown and Cancel). `data-write` makes it one of the controls a read-only workspace switches off.
 * It is a line in its place (the card, the panel's foot): it is never fixed to the screen.
 */
export function AskForm({ session, look, placeholder, inputId = "ask-input" }: { session: AskSession; look: AskLook; placeholder: string; inputId?: string }) {
  const s = session;
  const { w } = s;
  const round = look === "box" ? "rounded-lg size-12" : "rounded-full size-12 md:size-14";
  const inputClass = look === "box" ? "min-h-12 min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-brand-edge" : "min-h-12 min-w-0 flex-1 rounded-full border border-edge bg-bg px-5 text-base text-ink placeholder:text-muted focus:border-brand-edge md:min-h-14";
  const soft = look !== "box";
  return (
    <>
      <form
        data-write
        data-ask-form={look}
        className={look === "box" ? "mt-4 flex items-stretch gap-2" : "flex items-center gap-2"}
        onSubmit={(e) => {
          e.preventDefault();
          void s.ask(s.text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {w("ask.label")}
        </label>
        {s.recording ? (
          <div data-voice="recording" className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 border border-brand-edge bg-bg px-4 text-base text-ink ${soft ? "rounded-full md:min-h-14" : "rounded-lg"}`}>
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-red-text motion-safe:animate-pulse" />
            <span className="max-sm:sr-only font-semibold">{s.recorder.state === "starting" ? w("ask.voice.starting") : w("ask.listening")}</span>
            {s.recorder.state === "recording" ? (
              <span data-voice="countdown" className="ml-auto whitespace-nowrap tabular-nums">
                {w("ask.voice.left").replace("{time}", clock(s.recorder.left))}
              </span>
            ) : null}
          </div>
        ) : (
          <input
            id={inputId}
            value={s.text}
            maxLength={MAX_QUESTION}
            onChange={(e) => s.setText(e.target.value)}
            onFocus={() => s.setFocused(true)}
            onBlur={() => s.setFocused(false)}
            placeholder={placeholder}
            autoComplete="off"
            className={inputClass}
          />
        )}
        {s.showMic ? (
          <button
            type="button"
            onClick={s.micClick}
            onPointerDown={s.micDown}
            onPointerUp={s.micUp}
            onPointerCancel={s.micUp}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={s.recording}
            aria-label={s.recording ? w("ask.mic.stop") : w("ask.mic")}
            title={s.recording ? w("ask.mic.stop") : w("ask.mic")}
            data-voice="mic"
            className={`inline-flex ${round} shrink-0 touch-none select-none items-center justify-center border ${s.recording || soft ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}
          >
            {s.recording ? <Square className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
        {/* Cancel takes the place of Ask: the microphone must not move when recording starts, or the tap that started it would land on Cancel */}
        {s.recording ? (
          <button type="button" onClick={() => s.recorder.cancel()} aria-label={w("ask.voice.cancel")} title={w("ask.voice.cancel")} className={`inline-flex ${round} shrink-0 items-center justify-center border border-edge bg-surface text-ink hover:bg-surface-2 sm:w-auto sm:gap-2 sm:px-4`}>
            <X className="size-5" aria-hidden="true" />
            <span className="max-sm:sr-only text-base font-semibold">{w("ask.voice.cancel")}</span>
          </button>
        ) : null}
        {s.recording ? null : s.asking ? (
          <button type="button" onClick={s.stop} className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 border border-edge bg-surface text-base font-semibold text-ink hover:bg-surface-2 ${soft ? "rounded-full md:size-14" : "rounded-lg px-3 sm:px-4"}`}>
            <Square className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{w("ask.stop")}</span>
          </button>
        ) : (
          <button type="submit" disabled={s.text.trim() === ""} className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 border text-base font-semibold hover:brightness-95 disabled:opacity-50 ${soft ? "size-12 rounded-full border-edge bg-surface text-ink md:size-14" : "rounded-lg border-brand-edge bg-brand px-3 text-on-brand sm:px-4"}`}>
            <Send className={soft ? "size-5" : "size-4"} aria-hidden="true" />
            <span className={soft ? "sr-only" : "sr-only sm:not-sr-only"}>{w("ask.send")}</span>
          </button>
        )}
      </form>
      {s.recording ? (
        <p role="status" className="sr-only">
          {s.recorder.state === "recording" ? w("ask.voice.recording.sr").replace("{s}", String(s.recorder.left <= 10 ? Math.ceil(s.recorder.left / 5) * 5 : 60)) : ""}
        </p>
      ) : null}
      {s.showMic && !s.seen ? (
        <p data-voice="privacy" className="mt-2 text-sm text-muted">
          {w("ask.mic.privacy")} {w("ask.voice.hint")}
        </p>
      ) : null}
      {s.showMic && s.status.speech ? (
        <button type="button" role="switch" aria-checked={s.autoplay} onClick={() => s.setAutoplay(!s.autoplay)} data-voice="autoplay" className="mt-2 inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-sm text-ink">
          <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border ${s.autoplay ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
            <span className={`absolute size-4 rounded-full bg-on-brand shadow ${s.autoplay ? "left-6" : "left-1 bg-muted"}`} />
          </span>
          {w("ask.voice.autoplay")}
        </button>
      ) : null}
      {s.problem ? (
        <p role="status" className="mt-2 text-sm text-amber-text">
          {w(PROBLEM_WORD[s.problem])}
        </p>
      ) : null}
    </>
  );
}

/** The suggestion chips: each asks its own words at once. Shown under the line before a question and under the answer after it. */
export function AskChips({ session, chips, className = "" }: { session: AskSession; chips: readonly string[]; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <ul data-ask="chips" className={`flex flex-wrap gap-2 ${className}`} aria-label={session.w("ask.title")}>
      {chips.map((c) => (
        <li key={c}>
          <button type="button" data-write onClick={() => void session.ask(c)} className={chipClass}>
            {c}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Sources({ sources, w }: { sources: Exchange["sources"]; w: (k: string) => string }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold">{w("ask.sources")}</h3>
      <ul className="mt-1 flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <li key={`${s.href ?? "-"}-${i}`} className="max-w-full min-w-0">
            {s.href ? (
              <Link href={s.href} prefetch={false} className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink [overflow-wrap:anywhere] hover:bg-surface-2">
                {s.label}
              </Link>
            ) : (
              <span className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-muted [overflow-wrap:anywhere]">{s.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Drafts({ drafts, w }: { drafts: Exchange["drafts"]; w: (k: string) => string }) {
  if (!drafts.length) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{w("ask.drafts")}</h3>
      <ul className="mt-2 space-y-3">
        {drafts.map((d) => (
          <li key={d.id}>
            <article aria-label={d.title} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-edge bg-surface px-2 py-0.5 text-sm font-semibold">{w("today.state.draft")}</span>
                <span className="text-sm font-medium text-muted">{KIND_WORD[d.kind] ? w(KIND_WORD[d.kind]) : ""}</span>
                {d.machine ? <span className="text-sm font-medium text-muted">{w("ask.machine")}</span> : null}
              </div>
              <h4 className="mt-2 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{d.title}</h4>
              <p lang={d.language ?? undefined} className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{d.summary}</p>
              {d.gloss ? (
                <p className="mt-2 border-l-2 border-edge pl-3 text-base text-muted [overflow-wrap:anywhere]">
                  <span className="font-semibold">{w("ask.gloss")}</span> {d.gloss}
                </p>
              ) : null}
              {d.href ? (
                <>
                  <Link href={d.href} prefetch={false} className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-lg border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand hover:brightness-95">
                    {w("ask.approve")}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                  <p className="mt-2 text-sm text-muted">{w("ask.approve.hint")}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">{w("ask.noscreen")}</p>
              )}
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One earlier exchange, in the list that "Show earlier" opens: the question, the answer, the screens it came from. */
function EarlierOne({ x, w }: { x: Exchange; w: (k: string) => string }) {
  return (
    <li data-ask="earlier-item" className="rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-sm text-muted">{x.asked ? `${w(x.heardByVoice ? "ask.voice.said" : "ask.asked")} ${x.asked}` : ""}</p>
      {x.answer ? <p className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{x.answer}</p> : null}
      {x.failed && !x.answer ? <p className="mt-1 text-base font-medium text-red-text">{x.errorCode !== null && ERROR_WORD[x.errorCode] ? w(ERROR_WORD[x.errorCode]) : w("ask.error")}</p> : null}
      <Sources sources={x.sources} w={w} />
    </li>
  );
}

/**
 * The thread: the latest question and its answer (streaming, with sources, drafts and the spoken answer), and above it "Show earlier (n)", which opens the earlier exchanges of this visit. `chips` are offered again under a finished answer.
 * The answer area is a live region and the page follows it while it streams (use-follow-answer.ts).
 */
export function AskAnswer({ session, chips = [], earlierWord, scrollRoot = false }: { session: AskSession; chips?: readonly string[]; earlierWord: string; scrollRoot?: boolean }) {
  const s = session;
  const { w } = s;
  const [showEarlier, setShowEarlier] = React.useState(false);
  // keeps the newest words in view while an answer streams (use-follow-answer.ts); the view owns it, so it reads no ref of the session
  const answerRef = useFollowAnswer(s.runs, s.asking, `${s.answer.length}|${s.sources.length}|${s.drafts.length}|${s.phase}`);
  const has = s.phase !== "idle";
  if (!has && s.earlier.length === 0) return null;
  return (
    <div data-ask="thread">
      {s.earlier.length > 0 ? (
        <div className={has ? "mb-3" : ""}>
          <button type="button" data-ask="show-earlier" aria-expanded={showEarlier} onClick={() => setShowEarlier((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand-text hover:underline">
            {earlierWord.replace("{n}", String(s.earlier.length))}
          </button>
          {showEarlier ? (
            <ul className="mt-2 space-y-3" data-ask="earlier">
              {s.earlier.map((x, i) => (
                <EarlierOne key={i} x={x} w={w} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {has ? (
        <div ref={answerRef} data-ask="answer" className={scrollRoot ? "" : "border-t border-line pt-4"} aria-live="polite" aria-busy={s.asking}>
          <p className="text-sm text-muted">{s.asked ? `${w(s.heardByVoice ? "ask.voice.said" : "ask.asked")} ${s.asked}` : s.heardByVoice ? w("ask.voice.working") : ""}</p>
          {s.answer ? <p className="mt-2 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{s.answer}</p> : s.asking ? <p className="mt-2 text-base text-muted">{w("ask.thinking")}</p> : null}
          {s.hasAudio ? (
            <button type="button" data-voice="play" onClick={s.togglePlay} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2">
              {s.playing ? <Square className="size-4" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
              {s.playing ? w("ask.stop") : w("ask.voice.play")}
            </button>
          ) : null}
          {s.audioPending ? <p className="mt-2 text-sm text-muted">{w("ask.voice.speaking")}</p> : null}
          {s.audioFailed ? <p className="mt-2 text-sm text-muted">{w("ask.voice.audioerr")}</p> : null}
          {s.phase === "error" ? (
            <p role="alert" className="mt-2 text-base font-medium text-red-text">
              {s.errorCode !== null && ERROR_WORD[s.errorCode] ? w(ERROR_WORD[s.errorCode]) : w("ask.error")}
            </p>
          ) : null}
          <Sources sources={s.sources} w={w} />
          <Drafts drafts={s.drafts} w={w} />
          {s.phase !== "asking" ? <AskChips session={s} chips={chips} className="mt-4" /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Voice mode (job DM): the full-screen circle over the box, opened by the microphone; drawn by whichever view is on the page. */
export function AskVoiceMode({ session }: { session: AskSession }) {
  const s = session;
  const { w } = s;
  if (!s.voiceOpen) return null;
  return (
    <VoiceMode
      phase={s.voicePhase}
      caption={s.problem || s.phase === "error" ? w("ask.voice.mode.problem") : ""}
      left={s.recorder.state === "recording" ? s.recorder.left : null}
      words={{ title: w("ask.voice.mode"), listening: w("ask.voice.mode.listening"), starting: w("ask.voice.mode.starting"), thinking: w("ask.voice.mode.thinking"), speaking: w("ask.voice.mode.answering"), done: w("ask.voice.done"), show: w("ask.voice.show"), cancel: w("ask.voice.mode.cancel"), tap: w("ask.voice.tap"), close: w("ask.voice.close") }}
      onTapOrb={() => (s.recorder.state === "recording" ? s.recorder.stop() : s.recorder.state === "idle" ? s.startVoice() : undefined)}
      onDone={() => s.recorder.stop()}
      onCancel={() => {
        s.recorder.cancel();
        s.setVoiceOpen(false);
      }}
      onClose={() => {
        if (s.recorder.state !== "idle") s.recorder.cancel();
        s.setVoiceOpen(false);
      }}
    />
  );
}
