"use client";

import { X } from "lucide-react";
import * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";

import { useAnalyser } from "./audio-level";

export type VoicePhase = "starting" | "listening" | "thinking" | "answering" | "done" | "error";
export type VoiceModeWords = { title: string; listening: string; starting: string; thinking: string; speaking: string; done: string; show: string; cancel: string; tap: string; close: string };

/** The orb's state for each phase: it follows the microphone while it listens, thinks faster, and ripples while it speaks (the circle is the whole picture of voice mode). */
const ORB: Record<VoicePhase, OrbState> = { starting: "think", listening: "listen", thinking: "think", answering: "speak", done: "still", error: "still" };

/**
 * Voice mode (job DM): the full-screen screen that opens when the person taps the microphone in the Ask bar. One big centred circle (job DM's orb), one line under it that says what is happening (listening, thinking, answering; never the words of
 * the answer, which are on the screen behind) and one button: "Done" while it listens, "Show the answer" when it has answered, "Cancel" to throw a recording away. Tapping the circle starts or stops the recording too, so a person who cannot find the
 * button still can. It sits ON the Ask box's own recording (the box owns the recorder, the question and the answer: this file only draws them), is a modal dialog (focus goes to its button, Escape closes it) and stands still with
 * "reduce motion" (the circle's own CSS). The words come in as props.
 */
export function VoiceMode({ phase, caption, left, words, onTapOrb, onDone, onCancel, onClose }: { phase: VoicePhase; caption: string; /** Seconds left of the recording (shown only while it listens). */ left: number | null; words: VoiceModeWords; onTapOrb: () => void; onDone: () => void; onCancel: () => void; onClose: () => void }) {
  const analyser = useAnalyser();
  const button = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    button.current?.focus();
  }, []);
  const line = phase === "starting" ? words.starting : phase === "listening" ? words.listening : phase === "thinking" ? words.thinking : phase === "answering" ? words.speaking : phase === "done" ? words.tap : caption;
  const recording = phase === "starting" || phase === "listening";
  return (
    <div role="dialog" aria-modal="true" aria-label={words.title} data-voice="mode" data-phase={phase} className="fixed inset-0 z-[70] flex flex-col items-center bg-bg px-6 pb-8 pt-4 text-ink">
      <div className="flex w-full items-center justify-end">
        <button type="button" onClick={onClose} aria-label={words.close} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-edge bg-surface hover:bg-surface-2">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 text-center">
        <button type="button" onClick={onTapOrb} aria-label={recording ? words.listening : words.tap} data-voice="orb" className="rounded-full">
          <Orb px={220} state={ORB[phase]} halo={phase === "listening" || phase === "answering"} analyser={analyser} />
        </button>
        <div aria-live="polite" className="flex max-w-md flex-col gap-2">
          <p className="font-display text-2xl font-semibold leading-snug [overflow-wrap:anywhere]">{line}</p>
          {phase === "listening" && left !== null ? (
            <p data-voice-mode="countdown" className="text-base tabular-nums text-muted">
              {`${Math.floor(Math.ceil(left) / 60)}:${String(Math.ceil(left) % 60).padStart(2, "0")}`}
            </p>
          ) : null}
          {phase === "error" ? <p className="text-base text-muted">{words.tap}</p> : null}
        </div>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {recording ? (
          <>
            <button ref={button} type="button" onClick={onDone} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-ink px-6 text-base font-semibold text-bg">
              {words.done}
            </button>
            <button type="button" onClick={onCancel} className="inline-flex min-h-12 items-center justify-center rounded-2xl px-6 text-base font-semibold text-brand-text">
              {words.cancel}
            </button>
          </>
        ) : (
          <button ref={button} type="button" onClick={onClose} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-ink px-6 text-base font-semibold text-bg">
            {words.show}
          </button>
        )}
      </div>
    </div>
  );
}
