import { OUTBOX_REASONS, type OutboxEvent } from "@/lib/api/outbox";

import { say, type TodayWords } from "../today/today-words";
import { stamp } from "./outbox-time";

/** The hours (India time) a business sends nothing between, from `GET /outbox/settings` (Owner and Admin); null when this person may not read them. */
export type QuietHours = { start: number; end: number } | null;

const hour = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** A reason in plain words: our own word for the reasons we know, else the API's fixed English sentence, else nothing. */
function reasonWords(e: OutboxEvent, words: TodayWords): string {
  if (e.reason !== null && (OUTBOX_REASONS as readonly string[]).includes(e.reason)) return say(words, `outbox.reason.${e.reason}`);
  return e.reason_text ?? "";
}

/**
 * One step of a message's REAL history (job BB's events), as one plain sentence: who did it (a person by name when the API gives one, Agent OWL, the shop's own template or the scheduler) and what happened.
 * "Held" for quiet hours says the actual hours when this person may read them, else the API's own generic sentence. An event has no words of the message in it, so nothing private is here but the name of a co-member.
 */
export function eventText(e: OutboxEvent, words: TodayWords, quiet: QuietHours): string {
  const named = (key: string) => (e.actor.name ? say(words, key, { name: e.actor.name }) : say(words, `${key}.noname`));
  switch (e.kind) {
    case "made":
      return e.actor.kind === "person" ? named("outbox.ev.made.person") : say(words, e.actor.kind === "assistant" ? "outbox.ev.made.assistant" : "outbox.ev.made.system");
    case "queued":
      return say(words, "outbox.ev.queued");
    case "held":
      if (e.reason === "quiet_hours") return quiet ? say(words, "outbox.ev.held.quiet", { start: hour(quiet.start), end: hour(quiet.end) }) : (e.reason_text ?? say(words, "outbox.ev.held"));
      return say(words, "outbox.ev.held.other", { reason: reasonWords(e, words) });
    case "needs_approval":
      return say(words, "outbox.ev.needs", { reason: reasonWords(e, words) });
    case "approved":
      return named("outbox.ev.approved");
    case "rejected":
      return named("outbox.ev.rejected");
    case "edited":
      return named("outbox.ev.edited");
    case "blocked":
      return say(words, "outbox.ev.blocked", { reason: reasonWords(e, words) });
    case "sent":
      return say(words, e.actor.kind === "worker" ? "outbox.ev.sent.worker" : "outbox.ev.sent");
    case "failed":
      return say(words, "outbox.ev.failed");
  }
}

/** The history as lines with their time, oldest first (the API sends them in order; sorting keeps it right if two share a minute). */
export function eventLines(events: readonly OutboxEvent[], words: TodayWords, now: number, lang: string, quiet: QuietHours): { at: string; text: string }[] {
  return [...events]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((e) => ({ at: e.at, text: `${stamp(e.at, now, lang)} · ${eventText(e, words, quiet)}` }));
}
