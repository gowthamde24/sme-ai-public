import { describe, expect, it } from "vitest";

import { STATUSES } from "@/components/v2/app/ds/StatusPill";
import type { BatchAnswer } from "@/lib/outreach/types";

import { CARD_STATES, CARD_STATUS, cardFromBatch, cardFromReminder, groupCards, hoursLine, progressOf } from "./cards";

const BASE = "/app/tenants/t1";
const batch = (status: string, progress: unknown, over: Record<string, unknown> = {}): BatchAnswer =>
  ({
    batch: { id: "b1", name: "IndiaMART leads", status, pausedReason: null, goal: "site_visit", channel: "call", ...over },
    plan: { count: 40, ready: 30, skipped: {}, sample: [], windowFrom: null, windowTo: null, estimatedMinutes: 90, estimatedMessages: 0, estimatedCostPaise: 40_000, maxCallsPerDay: null, maxTotalMinutes: null },
    progress,
  }) as unknown as BatchAnswer;

describe("campaign cards", () => {
  it("colours every state with one of the six status colours", () => {
    for (const s of CARD_STATES) expect(STATUSES).toContain(CARD_STATUS[s]);
  });
  it("makes a card from a list that waits for the OK, with what the estimate needs", () => {
    const c = cardFromBatch(batch("planned", null), BASE);
    expect(c).toMatchObject({ kind: "list", state: "planned", total: 30, done: 0, people: 30, href: `${BASE}/outreach/batches/b1`, goal: "site_visit" });
    expect(c.forEstimate).toEqual({ calls: 30, avgMinutes: 3, estimatedMinutes: 90, estimatedCostPaise: 40_000 });
  });
  it("makes a running card with progress and results; unknown results stay null", () => {
    const c = cardFromBatch(batch("running", { total: 30, waiting: 10, done: 20, callsMade: 20, connected: 12, interested: 5, minutesUsed: 60 }), BASE);
    expect(c).toMatchObject({ state: "running", done: 20, total: 30, forEstimate: null });
    expect(c.results).toEqual({ visits: null, quotesPaise: null, interested: 5, paidPaise: null });
    const known = cardFromBatch(batch("running", { total: 30, waiting: 10, done: 20, callsMade: 20, connected: 12, interested: 5, minutesUsed: 60, visitsBooked: 3, quotesPaise: 1_250_000 }), BASE);
    expect(known.results).toMatchObject({ visits: 3, quotesPaise: 1_250_000 });
  });
  it("tells a pause the owner made (they can undo it) from one a limit made", () => {
    expect(cardFromBatch(batch("paused", null, { pausedReason: "owner" }), BASE).pausedBy).toBe("owner");
    expect(cardFromBatch(batch("paused", null, { pausedReason: null }), BASE).pausedBy).toBe("owner");
    expect(cardFromBatch(batch("paused", null, { pausedReason: "cap_minutes" }), BASE).pausedBy).toBe("limit");
    expect(cardFromBatch(batch("running", null), BASE).pausedBy).toBeNull();
    expect(cardFromBatch(batch("cancelled", null), BASE).state).toBe("stopped");
  });
  it("a WhatsApp list needs no call estimate", () => {
    expect(cardFromBatch(batch("planned", null, { channel: "whatsapp" }), BASE).forEstimate).toBeNull();
  });
  it("makes a card from a reminder campaign: progress is the messages sent or ended, results are what was paid after a reminder", () => {
    const campaign = { id: "c1", name: "October fees", kind: "fee_due", status: "running", recipients: 18 } as never;
    const results = { by_state: { planned: 5, sent: 9, delivered: 14, read: 6, blocked: 3, skipped: 2, held: 1 }, replied: 4, paid_after_reminder: { recipients: 5, amount_paise: 9_200_000 } } as never;
    const c = cardFromReminder(campaign, results, BASE);
    expect(c).toMatchObject({ kind: "reminder", state: "running", done: 34, total: 40, people: 18, channel: "whatsapp", href: `${BASE}/campaigns/c1` });
    expect(c.results).toEqual({ visits: null, quotesPaise: null, interested: 4, paidPaise: 9_200_000 });
    expect(cardFromReminder({ ...(campaign as object), status: "approved" } as never, null, BASE)).toMatchObject({ state: "planned", done: 0, total: 0 });
    expect(cardFromReminder({ ...(campaign as object), status: "draft" } as never, null, BASE).results).toEqual({ visits: null, quotesPaise: null, interested: null, paidPaise: null });
  });
  it("groups: waiting for the owner, going on, finished", () => {
    const mk = (state: string) => ({ state }) as never;
    const g = groupCards([mk("draft"), mk("planned"), mk("running"), mk("paused"), mk("done"), mk("stopped")]);
    expect(g.waiting.map((c) => c.state)).toEqual(["draft", "planned"]);
    expect(g.active.map((c) => c.state)).toEqual(["running", "paused"]);
    expect(g.finished.map((c) => c.state)).toEqual(["done", "stopped"]);
  });
  it("keeps a bar inside its total", () => {
    expect(progressOf({ done: 40, total: 30 })).toEqual({ value: 30, max: 30 });
    expect(progressOf({ done: -2, total: 30 })).toEqual({ value: 0, max: 30 });
    expect(progressOf({ done: 0, total: 0 })).toEqual({ value: 0, max: 0 });
  });
});

describe("calling hours in a line", () => {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  it("joins days in a row and lists the others", () => {
    expect(hoursLine({ days: [1, 2, 3, 4, 5, 6], fromMinute: 540, toMinute: 1140, from: "assistant" }, names, "to")).toBe("Mon to Sat, 09:00 to 19:00");
    expect(hoursLine({ days: [1, 3, 5], fromMinute: 600, toMinute: 1050, from: "default" }, names, "to")).toBe("Mon, Wed, Fri, 10:00 to 17:30");
    expect(hoursLine({ days: [2], fromMinute: 540, toMinute: 600, from: "default" }, names, "to")).toBe("Tue, 09:00 to 10:00");
    expect(hoursLine({ days: [], fromMinute: 540, toMinute: 600, from: "default" }, names, "to")).toBe("09:00 to 10:00");
  });
});
