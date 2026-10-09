/**
 * The words of the "Ask your team" box. They live in a file of their own, NOT in AskTeam.tsx: that file is a client component, and a server component (TodayView) that imports a
 * constant from a client file gets a reference to it, not the value. The server resolves each key in the person's language and hands the result down as props.
 */
export const ASK_WORD_KEYS = [
  "ask.title", "ask.sub", "ask.label", "ask.placeholder", "ask.send", "ask.stop", "ask.mic", "ask.mic.stop", "ask.listening", "ask.mic.privacy", "ask.mic.denied", "ask.mic.silent", "ask.mic.failed",
  "ask.chip.needs", "ask.chip.quotes", "ask.chip.money", "ask.chip.team", "ask.asked", "ask.thinking", "ask.sources", "ask.drafts", "today.state.draft", "today.kind.quote", "today.kind.followup", "ask.approve",
  "ask.approve.hint", "ask.error", "frame.notyet", "office.switchedoff",
] as const;
export type AskWords = Readonly<Record<string, string>>;
