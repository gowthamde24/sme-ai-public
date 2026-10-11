/**
 * The words of the "Ask your team" box. They live in a file of their own, NOT in AskTeam.tsx: that file is a client component, and a server component (TodayView) that imports a
 * constant from a client file gets a reference to it, not the value. The server resolves each key in the person's language and hands the result down as props.
 */
export const ASK_WORD_KEYS = [
  "ask.title", "ask.sub", "ask.label", "ask.placeholder", "ask.placeholder.hero", "ask.send", "ask.stop", "ask.mic", "ask.mic.stop", "ask.listening", "ask.mic.privacy", "ask.mic.denied", "ask.mic.silent", "ask.mic.failed",
  "ask.voice.starting", "ask.voice.left", "ask.voice.cancel", "ask.voice.recording.sr", "ask.voice.hint", "ask.voice.autoplay", "ask.voice.nomic", "ask.voice.short", "ask.voice.toolong", "ask.voice.err.unavailable", "ask.voice.err.failed", "ask.voice.err.network", "ask.voice.said", "ask.voice.working", "ask.voice.play", "ask.voice.speaking", "ask.voice.audioerr",
  "ask.chip.needs", "ask.chip.quotes", "ask.chip.money", "ask.chip.team", "ask.asked", "ask.thinking", "ask.sources", "ask.drafts", "today.state.draft", "today.kind.quote", "today.kind.followup", "ask.approve",
  "ask.approve.hint", "ask.error", "ask.err.cost", "ask.err.limit", "ask.err.role", "ask.err.busy", "ask.err.notset", "ask.machine", "ask.gloss", "ask.noscreen", "ask.kind.reply", "ask.kind.enquiry", "ask.kind.visit", "frame.notyet", "office.switchedoff", "agent.main", "owl.mood.idle", "owl.mood.listening", "owl.mood.thinking", "owl.mood.answering", "owl.mood.resting",
] as const;
export type AskWords = Readonly<Record<string, string>>;
