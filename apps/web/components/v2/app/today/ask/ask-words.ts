/**
 * The words of the "Ask your team" box. They live in a file of their own, NOT in AskTeam.tsx: that file is a client component, and a server component (TodayView) that imports a
 * constant from a client file gets a reference to it, not the value. The server resolves each key in the person's language and hands the result down as props.
 */
export const ASK_WORD_KEYS = [
  "ask.can.button", "ask.can.title", "ask.can.yes", "ask.can.no", "ask.can.y1", "ask.can.y2", "ask.can.y3", "ask.can.y4", "ask.can.n1", "ask.can.n2", "ask.can.n3", "ask.can.n4", "ask.can.try", "ask.can.guide", "ask.can.close", "ask.can.steps",
  // the six steps of "What can Agent OWL do?" (job CZ): title, line, what the owner does, and the helper's name (the pack's own word: a school's Lead Finder is the Admissions Desk)
  "ask.can.step.1.t", "ask.can.step.1.d", "ask.can.step.1.y", "ask.can.step.2.t", "ask.can.step.2.d", "ask.can.step.2.y", "ask.can.step.3.t", "ask.can.step.3.d", "ask.can.step.3.y", "ask.can.step.4.t", "ask.can.step.4.d", "ask.can.step.4.y", "ask.can.step.5.t", "ask.can.step.5.d", "ask.can.step.5.y", "ask.can.step.6.t", "ask.can.step.6.d", "ask.can.step.6.y",
  "ask.title", "ask.sub", "ask.label", "ask.placeholder", "ask.placeholder.hero", "ask.send", "ask.stop", "ask.mic", "ask.mic.stop", "ask.listening", "ask.mic.privacy", "ask.mic.denied", "ask.mic.silent", "ask.mic.failed",
  "ask.voice.starting", "ask.voice.mode", "ask.voice.done", "ask.voice.show", "ask.voice.tap", "ask.voice.close", "ask.voice.left", "ask.voice.cancel", "ask.voice.recording.sr", "ask.voice.hint", "ask.voice.autoplay", "ask.voice.nomic", "ask.voice.short", "ask.voice.toolong", "ask.voice.err.unavailable", "ask.voice.err.failed", "ask.voice.err.network", "ask.voice.said", "ask.voice.working", "ask.voice.play", "ask.voice.speaking", "ask.voice.audioerr",
  "ask.chip.needs", "ask.chip.quotes", "ask.chip.money", "ask.chip.team", "ask.asked", "ask.thinking", "ask.sources", "ask.drafts", "today.state.draft", "today.kind.quote", "today.kind.followup", "ask.approve",
  "ask.approve.hint", "ask.error", "ask.err.cost", "ask.err.limit", "ask.err.role", "ask.err.busy", "ask.err.notset", "ask.machine", "ask.gloss", "ask.noscreen", "ask.kind.reply", "ask.kind.enquiry", "ask.kind.visit", "frame.notyet", "office.switchedoff", "agent.main", "owl.mood.idle", "owl.mood.listening", "owl.mood.thinking", "owl.mood.answering", "owl.mood.resting",
] as const;
export type AskWords = Readonly<Record<string, string>>;
