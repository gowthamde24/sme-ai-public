/**
 * The MOCK conversations of "Talk live" (design system v6, owner 13 Nov 2026: "Voice is mocked on staging"). A script is a list of steps, each at a time (ms after the start): the assistant's state (listening, speaking, thinking), a line of the transcript, or a plan card the owner answers.
 * The contents are made-up fixtures (like the demo data), not product text: the real conversation is the browser voice (lib/browser-voice) once it is wired to this bar. Pure data: no timers, no React.
 */
export type TalkState = "listening" | "speaking" | "thinking";
export type TalkLine = { who: "owner" | "assistant"; text: string };
export type TalkPlan = { what: string; time: string; cost: string; hours: string };
export type TalkStep = { at: number } & ({ kind: "state"; state: TalkState } | { kind: "line"; line: TalkLine } | { kind: "plan"; plan: TalkPlan });
export type TalkKind = "command" | "practice" | "setup";

export const SCRIPTS: Record<TalkKind, readonly TalkStep[]> = {
  // Today's command bar: the owner asks for a job, the assistant answers with a plan
  command: [
    { at: 0, kind: "state", state: "listening" },
    { at: 1200, kind: "line", line: { who: "owner", text: "Call everyone who asked about wedding sarees this week." } },
    { at: 2000, kind: "state", state: "thinking" },
    { at: 3000, kind: "state", state: "speaking" },
    { at: 3100, kind: "line", line: { who: "assistant", text: "Found 14 people. I will call them between 10 am and 5 pm and offer a store visit." } },
    { at: 6200, kind: "plan", plan: { what: "Call 14 people about wedding sarees", time: "about 40 minutes", cost: "about ₹180", hours: "10 am to 5 pm" } },
    { at: 6300, kind: "state", state: "listening" },
  ],
  // My assistant, Practice: the assistant is tried as a customer would try it
  practice: [
    { at: 0, kind: "state", state: "listening" },
    { at: 1200, kind: "line", line: { who: "owner", text: "Do you have Kanchipuram silk sarees under ₹20,000?" } },
    { at: 2000, kind: "state", state: "thinking" },
    { at: 2800, kind: "state", state: "speaking" },
    { at: 2900, kind: "line", line: { who: "assistant", text: "Yes, we have 12 Kanchipuram silks from ₹14,500. Would you like to visit today at 5 pm?" } },
    { at: 6000, kind: "state", state: "listening" },
  ],
  // Day one: "Not sure? Just talk." The assistant asks and the steps fill in
  setup: [
    { at: 0, kind: "state", state: "speaking" },
    { at: 100, kind: "line", line: { who: "assistant", text: "Tell me about your shop. What do you sell, and where are you?" } },
    { at: 3000, kind: "state", state: "listening" },
    { at: 4200, kind: "line", line: { who: "owner", text: "Silk sarees, in Anantapur, near the clock tower." } },
    { at: 5000, kind: "state", state: "thinking" },
    { at: 5800, kind: "state", state: "speaking" },
    { at: 5900, kind: "line", line: { who: "assistant", text: "Got it. I will add that to your shop details. Which hours are you open?" } },
    { at: 9000, kind: "state", state: "listening" },
  ],
};

/** The numbers and times of a line are shown in orange: ₹ amounts, clock times, "about N minutes", and plain counts. */
export const KEY_PIECES = /(₹\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\babout \d+ minutes?\b|\b\d{1,3}(?:,\d{3})*\b)/gi;

/** A line cut into plain pieces and key pieces (numbers, ₹, times), in order, so the screen can colour the key ones. */
export function pieces(text: string): { text: string; key: boolean }[] {
  const out: { text: string; key: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(KEY_PIECES)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), key: false });
    out.push({ text: m[0], key: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), key: false });
  return out;
}
