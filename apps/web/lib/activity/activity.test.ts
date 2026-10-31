import { afterEach, describe, expect, it, vi } from "vitest";

import { parseActivity } from "./types";
import { readActivity } from "./source";

const ID = "00000000-0000-4000-8000-000000000901";

describe("the activity feed of the API", () => {
  it("reads one item per piece of work, with the display name, the elapsed seconds and the target", () => {
    const feed = parseActivity({ items: [{ type: "call", who: "Ramesh", started_at: "2026-10-31T10:00:00Z", elapsed_s: 134, target: { kind: "task", id: ID } }, { type: "lead_read", who: null, elapsed_s: 3, target: null }], caught_up: false, poll_after_s: 5 });
    expect(feed).toEqual({ items: [{ type: "call", who: "Ramesh", elapsedS: 134, target: { kind: "task", id: ID } }, { type: "lead_read", who: null, elapsedS: 3, target: null }], pollAfterS: 5 });
  });
  it("drops what it cannot read: an unknown type, a target with a bad id or kind, a name that is far too long; clamps the poll time", () => {
    const feed = parseActivity({ items: [{ type: "dance" }, { type: "quote_draft", who: "x".repeat(200), elapsed_s: -4, target: { kind: "quote", id: "nope" } }, { type: "follow_up", who: "A", elapsed_s: 7, target: { kind: "weird", id: ID } }], poll_after_s: 1 });
    expect(feed?.items).toEqual([{ type: "quote_draft", who: null, elapsedS: 0, target: null }, { type: "follow_up", who: "A", elapsedS: 7, target: null }]);
    expect(feed?.pollAfterS).toBe(3);
  });
  it("is null for anything that is not an activity answer, and holds at most 20 items", () => {
    for (const bad of [null, "x", {}, { items: "no" }]) expect(parseActivity(bad)).toBeNull();
    expect(parseActivity({ items: Array.from({ length: 30 }, () => ({ type: "lead_read", who: null, elapsed_s: 1 })) })?.items).toHaveLength(20);
  });
});

describe("where the strip's data comes from", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("off: nothing; mock: a call with chats, then leads, then nothing, changing every 15 seconds", async () => {
    vi.stubEnv("ACTIVITY_SCREENS", "off");
    expect(await readActivity("tok", "t")).toBeNull();
    vi.stubEnv("ACTIVITY_SCREENS", "mock");
    const kinds = async (n: number) => (await readActivity("tok", "t", n * 15_000))?.items.map((i) => i.type);
    expect(await kinds(3)).toEqual(["call", "whatsapp_reply", "whatsapp_reply", "follow_up"]);
    expect(await kinds(4)).toEqual(["lead_read", "lead_read"]);
    expect(await kinds(5)).toEqual([]);
  });
});
