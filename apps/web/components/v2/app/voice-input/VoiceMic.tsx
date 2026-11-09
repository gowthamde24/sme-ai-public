"use client";

import { Mic, Square } from "lucide-react";
import * as React from "react";

import { callClock } from "@/lib/calls/view";

import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";
import { word } from "../labels";
import { useLabels } from "../robust/labels-context";
import { AskVoiceContext } from "../today/ask/ask-store";
import { hintSeen, markHintSeen, nextHear, readHear, subscribeHear, writeHear, type HearLang } from "./voice-lang";
import { useVoiceInput, type VoiceInputOptions } from "./use-voice-input";

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Fields that must NEVER get a microphone (owner decision, 9 Nov 2026): a password, a one-time code, a phone number, an e-mail address, a number, an address of a site, a card or bank detail. The field itself says so by its type, its
 * `inputmode`, its `autocomplete` or `data-voice="never"`; a field about a child (the school's student, parent and class fields) has `data-voice="never"` on it. This is checked again here, whatever the caller asked for.
 */
export function voiceAllowed(el: Field | null): boolean {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.dataset.voice === "never") return false;
  const type = el instanceof HTMLInputElement ? el.type : "textarea";
  if (!["text", "search", "textarea"].includes(type)) return false;
  if (/^(tel|email|numeric|decimal|url)$/.test(el.inputMode)) return false;
  if (/one-time-code|cc-|tel|email|username|password|bank|upi/.test(el.autocomplete) || /password|otp|upi|iban|ifsc|gstin|\bpan\b|phone|mobile|email|account/i.test(`${el.name} ${el.id}`)) return false;
  return true;
}

/** The new text of the field: the dictated words go in at the caret and nothing that was there is touched (a space is added only where the words would touch another word). The field's own length limit is kept. */
export function insertAt(value: string, pos: number, said: string, maxLength: number): string {
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const lead = before !== "" && !/\s$/.test(before) ? " " : "";
  const tail = after !== "" && !/^\s/.test(after) ? " " : "";
  let insertion = `${lead}${said}${tail}`;
  if (maxLength > 0) insertion = insertion.slice(0, Math.max(0, maxLength - value.length));
  return `${before}${insertion}${after}`;
}

/** Sets a field's value the way typing does, so a controlled field (React) hears it: the native setter, then an `input` event. Nothing is submitted. */
function setValue(el: Field, value: string, caret: number): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // some field types have no caret
  }
}

/**
 * The microphone for a text field (owner decision, 9 Nov 2026: many owners cannot type well in Telugu or Kannada, so every free-text field gets one). A 44 px button (`big`: the whole width, for a phone) that listens, with the states
 * asking permission, listening (a breathing ring and a timer; a tap stops), writing it down and a short error in the person's language; the words go in at the caret, nothing is replaced, nothing is saved or sent (the person
 * does that); "Undo" takes the last dictation out again. "Hearing: Telugu" is the language it listens for (the app's, until changed). Hidden where the browser cannot record, where voice is off for the workspace and on fields that
 * must never have one (see voiceAllowed). The first time it says "Your voice is turned into text and not saved." The audio goes to the API as it is spoken and is kept nowhere, in the browser or on the server.
 */
export function VoiceMic({ target, size = "icon", className = "", options }: { target: React.RefObject<Field | null>; /** "icon": a 44 px button; "wide": the whole width with its word on a phone (under 640 px), an icon above it; "big": always the whole width */ size?: "icon" | "wide" | "big"; className?: string; options?: VoiceInputOptions }) {
  const labels = useLabels();
  const frame = useFrameData(NO_FRAME_DATA);
  const v4 = frame.v4 === true; // (voice typing is part of app v4)
  // a school workspace's free text is about students, parents and classes: no microphone there, except on a field that says it is not (data-voice="allow", e.g. how the assistant talks to customers)
  const school = frame.pack?.modules.includes("programmes") === true;
  const voice = React.useContext(AskVoiceContext);
  const app = voice?.language ?? "en";
  const hear = React.useSyncExternalStore<HearLang>(subscribeHear, () => readHear(app), () => app);
  const [allowed, setAllowed] = React.useState(false);
  const [undo, setUndo] = React.useState<{ before: string; after: string; caret: number } | null>(null);
  const [showHint, setShowHint] = React.useState(false);
  const session = React.useRef<{ before: string; pos: number; last: string } | null>(null);
  const w = (key: string, english: string, vars?: Record<string, string>) => word(labels, key, english, vars);

  const onWords = (said: string) => {
    const el = target.current;
    const s = session.current;
    if (!el || !s) return;
    const next = insertAt(s.before, s.pos, said, el.maxLength);
    setValue(el, next, Math.min(next.length, s.pos + (next.length - s.before.length)));
    s.last = next;
  };
  const input = useVoiceInput(voice, hear, onWords, options);
  const { state, error } = input;

  // the field is known once it has drawn: whether it may have a microphone is decided then, and a change by typing takes the Undo away
  React.useEffect(() => {
    const el = target.current;
    // (decided after the first draw, when the field exists; done on the next tick so the draw itself is never re-done inside the effect)
    queueMicrotask(() => setAllowed(voiceAllowed(el) && !(school && el?.dataset.voice !== "allow")));
    if (!el) return;
    const typed = () => setUndo((u) => (u && el.value !== u.after ? null : u));
    el.addEventListener("input", typed);
    el.addEventListener("change", typed);
    return () => {
      el.removeEventListener("input", typed);
      el.removeEventListener("change", typed);
    };
  }, [target, school]);

  const wasActive = React.useRef(false);
  React.useEffect(() => {
    const active = state !== "idle";
    if (wasActive.current && !active) {
      const s = session.current;
      const el = target.current;
      if (s && el && s.last !== "" && s.last !== s.before) setUndo({ before: s.before, after: s.last, caret: s.pos });
      session.current = null;
      if (showHint) {
        markHintSeen();
        setShowHint(false);
      }
    }
    wasActive.current = active;
  }, [state, target, showHint]);

  if (!v4 || !input.supported || !allowed) return null;

  const press = () => {
    const el = target.current;
    if (!el) return;
    if (state === "idle") {
      setUndo(null);
      session.current = { before: el.value, pos: el.selectionEnd ?? el.value.length, last: el.value };
      setShowHint(!hintSeen());
    }
    input.toggle();
  };
  const doUndo = () => {
    const el = target.current;
    if (!el || !undo) return;
    setValue(el, undo.before, undo.caret);
    setUndo(null);
    el.focus();
  };
  const names = voice?.languageNames ?? ({} as Record<string, string>);
  const hearName = hear === "auto" ? w("vi.lang.auto", "Any language") : (names[hear] ?? hear);
  const listening = state === "listening";
  const busy = state === "asking" || state === "finishing";
  const label = listening ? w("vi.listening", "Listening… tap to stop") : w("vi.mic", "Speak instead of typing");
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${size === "big" ? "w-full" : size === "wide" ? "max-sm:w-full" : ""} ${className}`} data-voice-mic="" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={press}
          disabled={busy}
          aria-label={label}
          aria-pressed={listening}
          data-part="mic"
          className={`inline-flex items-center justify-center gap-2 rounded-full border font-semibold disabled:opacity-60 ${listening ? "vi-pulse border-[#ff773c] bg-[#ff773c] text-[#1e1e24]" : "border-edge bg-surface text-ink hover:border-brand-edge"} ${size === "big" ? "min-h-14 w-full text-base" : size === "wide" ? "min-h-11 min-w-11 px-3 text-sm max-sm:min-h-14 max-sm:w-full max-sm:text-base" : "min-h-11 min-w-11 px-3 text-sm"}`}
        >
          {listening ? <Square className="size-4 shrink-0 fill-current" aria-hidden="true" /> : <Mic className="size-5 shrink-0" aria-hidden="true" />}
          {listening ? <span className="tabular-nums">{callClock(input.seconds)}</span> : size === "big" ? <span>{w("vi.mic.short", "Speak")}</span> : size === "wide" ? <span className="sm:hidden">{w("vi.mic.short", "Speak")}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => writeHear(nextHear(hear))}
          disabled={state !== "idle"}
          aria-label={w("vi.lang.change", "Change the language it listens for")}
          data-part="hear"
          className="inline-flex min-h-11 items-center rounded-full bg-surface-2 px-3 text-xs font-semibold text-muted hover:text-ink disabled:opacity-60"
        >
          {w("vi.lang", "Hearing: {lang}", { lang: hearName })}
        </button>
        {undo ? (
          <button type="button" onClick={doUndo} aria-label={w("vi.undo.label", "Undo the last dictation")} data-part="undo" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-brand-text hover:underline">
            {w("vi.undo", "Undo")}
          </button>
        ) : null}
      </div>
      {state === "asking" ? (
        <p role="status" className="m-0 text-sm text-muted">
          {w("vi.asking", "Allow the microphone…")}
        </p>
      ) : state === "finishing" ? (
        <p role="status" className="m-0 text-sm text-muted">
          {w("vi.finishing", "Writing it down…")}
        </p>
      ) : null}
      {showHint && state !== "idle" ? (
        <p role="note" className="m-0 text-xs text-muted" data-part="hint">
          {w("vi.hint", "Your voice is turned into text and not saved.")}
        </p>
      ) : null}
      {input.notice === "keep_going" && state === "idle" && !error ? (
        <p role="status" className="m-0 text-sm font-semibold text-ink" data-part="keep-going">
          {w("vi.keepgoing", "Tap the mic to keep going")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm font-semibold text-amber-text" data-part="error" data-error={error}>
          {w(`vi.err.${error}`, error === "denied" ? "The microphone is blocked. Tap the lock icon next to the address, allow Microphone, then try again." : error === "no_speech" ? "Nothing was heard. Tap the mic and try again." : error === "daily" ? "Voice typing is paused for today, you can type." : "Voice typing isn't working right now. You can type.")}
        </p>
      ) : null}
    </div>
  );
}
