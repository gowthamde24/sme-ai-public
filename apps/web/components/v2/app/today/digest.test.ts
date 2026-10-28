import { describe, expect, it } from "vitest";

import { parseOutboxMessage } from "@/lib/api/outbox";
import { PRICE_JSON, QUIET_JSON, SENT_JSON } from "@/lib/api/outbox-fixtures";

import { MAX_LINES, summariseOutbox } from "./digest";

const NOW = Date.parse("2026-10-11T02:00:00Z"); // 7:30 in India
const msg = (over: Record<string, unknown>) => parseOutboxMessage({ ...SENT_JSON, ...over });
const sent = (category: string, minutesAgo: number, over: Record<string, unknown> = {}) => msg({ id: crypto.randomUUID(), category, sent_at: new Date(NOW - minutesAgo * 60_000).toISOString(), ...over });

describe("the outbox of the last 24 hours, boiled down", () => {
  it("counts what the your assistant itself sent, by kind, biggest first, and never reads the words", () => {
    const items = [sent("reply_to_inbound", 60), sent("reply_to_inbound", 120), sent("reply_to_inbound", 200), sent("info", 30), sent("visit", 45), sent("visit", 50)];
    const d = summariseOutbox(items, NOW);
    expect(d).toMatchObject({ state: "ready", sent: 6, held: 0 });
    expect(d.lines).toEqual([{ kind: "reply_to_inbound", n: 3 }, { kind: "visit", n: 2 }, { kind: "info", n: 1 }]);
  });
  it("ignores what a person sent, what is older than a day, what has not been sent, and what 'sent' claims for the future", () => {
    const d = summariseOutbox(
      [sent("info", 10, { source: "owner" }), sent("info", 25 * 60), sent("info", 10, { status: "queued" }), sent("info", -30), sent("info", 60)],
      NOW,
    );
    expect(d.sent).toBe(1);
    expect(d.lines).toEqual([{ kind: "info", n: 1 }]);
  });
  it("counts messages waiting for a person as held, and messages parked by the quiet hours as one line with the hour they go out", () => {
    const waiting = msg({ ...PRICE_JSON, created_at: new Date(NOW - 3600_000).toISOString() });
    const parked = parseOutboxMessage({ ...QUIET_JSON, scheduled_for: "2026-10-11T03:30:00Z" });
    const parkedLater = parseOutboxMessage({ ...QUIET_JSON, id: "11111111-aaaa-4aaa-8aaa-000000000009", scheduled_for: "2026-10-11T03:45:00Z" });
    const d = summariseOutbox([waiting, parked, parkedLater], NOW);
    expect(d).toMatchObject({ sent: 0, held: 1 });
    expect(d.lines).toEqual([{ kind: "quiet", n: 2, time: "9:00" }]);
  });
  it("a message that was parked and whose hour has come is not 'held' any more", () => {
    const d = summariseOutbox([parseOutboxMessage({ ...QUIET_JSON, scheduled_for: "2026-10-11T01:00:00Z" })], NOW);
    expect(d.lines).toEqual([]);
  });
  it("shows at most four lines", () => {
    const kinds = ["reply_to_inbound", "info", "visit", "followup", "order_status", "other"];
    const d = summariseOutbox(kinds.map((k) => sent(k, 30)), NOW);
    expect(d.sent).toBe(6);
    expect(d.lines).toHaveLength(MAX_LINES);
  });
  it("an empty log is zeros and no lines", () => {
    expect(summariseOutbox([], NOW)).toEqual({ state: "ready", sent: 0, held: 0, lines: [] });
  });
});
