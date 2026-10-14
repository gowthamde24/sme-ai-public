/** The moods of Agent OWL, as the Ask box drives them: the five of the plush owlet (PlushOwl). */
export type OwlMood = "idle" | "listening" | "thinking" | "answering" | "resting";

/** The codes of a refused answer after which the owl rests: the AI is paused, the agents are off, or the run limit is reached. */
export const RESTING_CODES: readonly string[] = ["ai_paused_until", "agents_disabled", "run_limit_reached"];

export type MoodInput = {
  /** Whether the box can ask at all (Agent OWL is built and switched on). */
  live: boolean;
  /** The input has the focus and something is typed (later: the microphone is on). */
  typing: boolean;
  /** The microphone is recording (or about to). */
  micOn?: boolean;
  /** The spoken answer is playing (job BF). */
  speaking?: boolean;
  /** "asking" = a request is out; "error" = the last answer failed. */
  phase: "idle" | "asking" | "done" | "error";
  /** Some `text` has arrived for the current answer. */
  hasText: boolean;
  /** The code of the last failure, when the box knows it. */
  errorCode?: string | null;
};

/**
 * The mood from the box's own state (the SSE flow of the answer):
 * resting = not live, or the last answer was refused with ai_paused_until / agents_disabled / run_limit_reached;
 * thinking = the request is sent and no `text` event has come; answering = `text` events are streaming;
 * listening = the microphone is recording, or the input is focused and the person is typing; answering also while the spoken answer plays; idle = nothing is happening.
 */
export function owlMood(i: MoodInput): OwlMood {
  if (!i.live) return "resting";
  if (i.phase === "error" && i.errorCode && RESTING_CODES.includes(i.errorCode)) return "resting";
  if (i.micOn) return "listening"; // recording wins: the person is talking
  if (i.phase === "asking") return i.hasText ? "answering" : "thinking";
  if (i.speaking) return "answering"; // the answer is being read out
  if (i.typing) return "listening";
  return "idle";
}
