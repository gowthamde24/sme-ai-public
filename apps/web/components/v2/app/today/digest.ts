import type { OutboxMessage } from "@/lib/api/outbox";

import { indiaClock } from "./time";
import type { Digest, DigestLine } from "./types";

const DAY_MS = 24 * 3600_000;
export const MAX_LINES = 4;

/**
 * The last 24 hours of the outbox log as a few numbers and at most four lines. Only what the Agent OWL did on its own counts as "sent": a message the assistant made (`source` "assistant")
 * that really went (`status` "sent", by its `sent_at`). Messages held back by the quiet hours (queued, reason `quiet_hours`) are one line with the hour they go out; messages waiting for a person
 * (`needs_you`) are the "held" number. The words of a message are never read here, only its category and state. Lines are biggest first, the quiet-hours line last among equals.
 */
export function summariseOutbox(items: readonly OutboxMessage[], nowMs: number): Extract<Digest, { state: "ready" }> {
  const since = nowMs - DAY_MS;
  const sentBy = new Map<string, number>();
  let sent = 0;
  let held = 0;
  let quiet = 0;
  let quietAt: string | null = null;
  for (const m of items) {
    if (m.status === "sent" && m.source === "assistant" && m.sent_at !== null && Date.parse(m.sent_at) >= since && Date.parse(m.sent_at) <= nowMs) {
      sent += 1;
      sentBy.set(m.category, (sentBy.get(m.category) ?? 0) + 1);
    } else if (m.status === "needs_approval" && Date.parse(m.created_at) >= since) {
      held += 1;
    } else if (m.status === "queued" && m.reason === "quiet_hours" && m.scheduled_for !== null && Date.parse(m.scheduled_for) > nowMs) {
      quiet += 1;
      if (quietAt === null || Date.parse(m.scheduled_for) < Date.parse(quietAt)) quietAt = m.scheduled_for;
    }
  }
  const lines: DigestLine[] = [...sentBy.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([kind, n]) => ({ kind: kind as DigestLine["kind"], n }));
  if (quiet > 0 && quietAt !== null) lines.push({ kind: "quiet", n: quiet, time: indiaClock(quietAt) });
  return { state: "ready", sent, held, lines: lines.slice(0, MAX_LINES) };
}
