import { describe, expect, it } from "vitest";

import { HIDDEN_POLL_MS, MAX_BACKOFF_MS, POLL_MS, nextDelay } from "./schedule";
import { MAX_NOTICES, MAX_SEEN, kindOf, markAllSeen, parseNotices, parseSeen, toAnnounce, unreadCount, unreadOf, type Notice } from "./model";

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const n = (id: string, over: Partial<Notice> = {}): Notice => ({ id, kind: "needs_you", code: "outbox_approval", who: "Asha", at: "2026-10-12T10:00:00Z", href: `${BASE}#needs-you`, ...over });

describe("parsing the server's answer", () => {
  it("keeps good notices, newest first, with the kind decided by the code", () => {
    const list = parseNotices({ items: [{ id: "a", code: "visit_here", who: "Lakshmi", at: "2026-10-12T09:00:00Z", href: `${BASE}/visits?visit=1` }, { id: "b", code: "outbox_approval", at: "2026-10-12T11:00:00Z", href: `${BASE}#needs-you` }] }, BASE);
    expect(list.map((x) => `${x.id}:${x.kind}`)).toEqual(["b:needs_you", "a:visit"]);
    expect(list[0].who).toBe("");
  });
  it("drops anything that is not ours: an unknown code, a bad time, a path outside the workspace, a path trick", () => {
    const bad = [
      { id: "1", code: "launch_missiles", at: "2026-10-12T10:00:00Z", href: `${BASE}` },
      { id: "2", code: "visit_here", at: "not a time", href: `${BASE}` },
      { id: "3", code: "visit_here", at: "2026-10-12T10:00:00Z", href: "https://evil.example/x" },
      { id: "4", code: "visit_here", at: "2026-10-12T10:00:00Z", href: "/app/tenants/99999999-9999-9999-9999-999999999999/orders" },
      { id: "5", code: "visit_here", at: "2026-10-12T10:00:00Z", href: `${BASE}/..\\x` },
      { id: "", code: "visit_here", at: "2026-10-12T10:00:00Z", href: BASE },
      { code: "visit_here", at: "2026-10-12T10:00:00Z", href: BASE },
      null,
      "x",
    ];
    expect(parseNotices({ items: bad }, BASE)).toEqual([]);
    for (const junk of [null, 3, "x", {}, { items: "no" }]) expect(parseNotices(junk, BASE)).toEqual([]);
  });
  it("keeps at most twenty", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `i${i}`, code: "visit_here", at: new Date(Date.UTC(2026, 9, 12, 0, i)).toISOString(), href: BASE }));
    expect(parseNotices({ items }, BASE)).toHaveLength(MAX_NOTICES);
  });
  it("kinds", () => {
    expect(kindOf("message_blocked")).toBe("blocked");
    expect(kindOf("visit_proposed")).toBe("needs_you");
    expect(kindOf("visit_here")).toBe("visit");
  });
});

describe("unread is per device", () => {
  it("counts what this device has not shown yet", () => {
    const items = [n("a"), n("b"), n("c")];
    expect(unreadCount(items, [])).toBe(3);
    expect(unreadOf(items, ["b"]).map((x) => x.id)).toEqual(["a", "c"]);
    expect(unreadCount(items, ["a", "b", "c"])).toBe(0);
  });
  it("marks what is shown as seen, without repeats, and never grows without bound", () => {
    expect(markAllSeen([n("a"), n("b")], ["x", "a"])).toEqual(["x", "a", "b"]);
    const many = Array.from({ length: MAX_SEEN + 50 }, (_, i) => `old${i}`);
    expect(markAllSeen([n("new")], many)).toHaveLength(MAX_SEEN);
    expect(markAllSeen([n("new")], many).at(-1)).toBe("new");
  });
  it("reads storage defensively", () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen("nope")).toEqual([]);
    expect(parseSeen('{"a":1}')).toEqual([]);
    expect(parseSeen('["a",3,"b"]')).toEqual(["a", "b"]);
  });
});

describe("browser notifications", () => {
  it("announce only 'needs you' notices that were not announced before", () => {
    const items = [n("a"), n("b", { kind: "visit", code: "visit_here" }), n("c", { kind: "blocked", code: "message_blocked" }), n("d")];
    expect(toAnnounce(items, ["a"]).map((x) => x.id)).toEqual(["d"]);
  });
});

describe("when the bell asks again", () => {
  const ok = { failures: 0, hidden: false, online: true, browserOptIn: false };
  it("every minute in front, with a little jitter", () => {
    expect(nextDelay(ok, 0.5)).toBe(POLL_MS);
    expect(nextDelay(ok, 0)).toBe(Math.round(POLL_MS * 0.9));
    expect(nextDelay(ok, 1)).toBe(Math.round(POLL_MS * 1.1));
  });
  it("backs off after each failure, up to ten minutes, and returns to a minute after a good answer", () => {
    const waits = [1, 2, 3, 4, 5, 9].map((failures) => nextDelay({ ...ok, failures }, 0.5));
    expect(waits).toEqual([120_000, 240_000, 480_000, MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
    expect(nextDelay({ ...ok, failures: 0 }, 0.5)).toBe(POLL_MS);
  });
  it("does not ask while the tab is hidden, unless browser notifications are on (then every five minutes, never faster)", () => {
    expect(nextDelay({ ...ok, hidden: true }, 0.5)).toBeNull();
    expect(nextDelay({ ...ok, hidden: true, browserOptIn: true }, 0.5)).toBe(HIDDEN_POLL_MS);
    expect(nextDelay({ ...ok, hidden: true, browserOptIn: true, failures: 3 }, 0.5)).toBe(MAX_BACKOFF_MS);
  });
  it("does not ask with no connection", () => {
    expect(nextDelay({ ...ok, online: false }, 0.5)).toBeNull();
    expect(nextDelay({ ...ok, online: false, hidden: true, browserOptIn: true }, 0.5)).toBeNull();
  });
});
