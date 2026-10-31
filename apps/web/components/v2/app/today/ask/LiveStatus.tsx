import { Mic } from "lucide-react";

import type { PanelVoice } from "./use-panel-voice";

/** What Live talk is doing, in one word: Connecting, Listening, Thinking, Speaking, or Paused (nobody has spoken for a while, it waits and will end by itself). */
export function liveStateOf(talk: Pick<PanelVoice, "state" | "connecting" | "checkIn">): "connecting" | "listening" | "thinking" | "speaking" | "paused" {
  if (talk.connecting) return "connecting";
  if (talk.state === "paused") return "paused"; // the API is judging a sound while it spoke
  if (talk.state === "speaking") return "speaking";
  if (talk.state === "thinking") return "thinking";
  return talk.checkIn !== null ? "paused" : "listening";
}
const WORD: Record<ReturnType<typeof liveStateOf>, string> = { connecting: "bv.connecting", listening: "bv.listening", thinking: "bv.thinking", speaking: "bv.speaking", paused: "bv.live.paused" };
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The Live talk strip above the box (job live-conversation-standard, web part): the microphone indicator (on for as long as the conversation is open, so the person always sees that it is listening), the state in words (Listening / Thinking / Speaking / Paused),
 * the "Stop talking" tap while it speaks, the one gentle check-in after a quiet spell (with the seconds left before it ends by itself), and the warning before the time limit. The words come from the dictionary (`bv.*`); the panel owns what happens on a tap.
 */
export function LiveStatus({ talk, c }: { talk: PanelVoice; c: (key: string) => string }) {
  const state = liveStateOf(talk);
  const looking = state === "thinking" && talk.step === "looking";
  return (
    <div data-chat="live-status" className="space-y-1">
      <p data-chat="live-badge" data-state={state} role="status" className="flex items-center gap-2 text-sm font-semibold text-brand-text">
        <span data-chat="mic" className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
          <Mic className="size-3.5" aria-hidden="true" />
          {state === "listening" ? <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-brand motion-safe:animate-ping" /> : null}
          <span className="sr-only">{c("bv.live.mic")}</span>
        </span>
        <span data-chat="live-state">{looking ? c("bv.looking") : c(WORD[state])}</span>
        {state === "speaking" ? (
          <button type="button" data-chat="stop-talk" onClick={talk.bargeIn} className="ml-auto min-h-8 rounded-full border border-edge bg-surface px-3 text-xs font-semibold text-ink">
            {c("bv.chat.stop")}
          </button>
        ) : null}
      </p>
      {talk.checkIn !== null ? (
        <p data-chat="check-in" role="status" className="text-sm text-muted">
          {c("bv.live.checkin").replace("{n}", String(talk.checkIn))}
        </p>
      ) : null}
      {talk.sessionLeft !== null ? (
        <p data-chat="session-warning" role="status" className="text-sm font-medium text-amber-text">
          {c("bv.live.timer").replace("{time}", clock(talk.sessionLeft))}
        </p>
      ) : null}
    </div>
  );
}
