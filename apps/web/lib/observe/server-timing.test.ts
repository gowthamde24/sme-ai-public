// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// (React's `cache` remembers per request on the server; here one remembers per test, as one request does)
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, cache: <A extends unknown[], R>(fn: (...a: A) => R) => { let v: { r: R } | undefined; return (...a: A) => (v ??= { r: fn(...a) }).r; } };
});

import { headerValue, inTimingScope, SPAN_NAME } from "./timing-format";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function load() {
  vi.resetModules();
  return import("./server-timing");
}
beforeEach(() => vi.stubEnv("SERVER_TIMING", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("the Server-Timing collector (SERVER_TIMING=1, staging only)", () => {
  it("records a span with its start and its length, and hands the answer on untouched", async () => {
    const { timed, settled } = await load();
    const answer = await timed("tenant", async () => {
      await sleep(30);
      return { role: "owner" };
    });
    expect(answer).toEqual({ role: "owner" });
    const spans = await settled(20, 1000);
    expect(spans).toHaveLength(1);
    expect(spans[0].n).toBe("tenant");
    expect(spans[0].d).toBeGreaterThanOrEqual(25);
    expect(spans[0].d).toBeLessThan(500);
  });

  it("keeps the span of a read that fails and lets the error through", async () => {
    const { timed, settled } = await load();
    await expect(timed("session", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(timed("sync_throw", () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await settled(20, 1000)).map((s) => s.n).sort()).toEqual(["session", "sync_throw"]);
  });

  it("shows that two reads ran together (their starts overlap) and that a third ran after them", async () => {
    const { timed, mark, settled } = await load();
    await Promise.all([timed("a", () => sleep(40)), timed("b", () => sleep(40))]);
    await timed("c", () => sleep(5));
    mark("app_shell");
    const [a, b, c, shell] = await settled(20, 1000);
    expect([a.n, b.n, c.n, shell.n]).toEqual(["a", "b", "c", "app_shell"]);
    expect(Math.abs(a.s - b.s)).toBeLessThan(15); // started together
    expect(c.s).toBeGreaterThanOrEqual(a.s + a.d - 2); // started after both had finished
    expect(shell.d).toBe(0);
  });

  it("waits for a read that is still running and for one that starts a little later (it stops when the render has gone quiet)", async () => {
    const { timed, settled } = await load();
    void timed("slow", () => sleep(120));
    setTimeout(() => void timed("late", () => sleep(10)), 50);
    const names = (await settled(100, 3000)).map((s) => s.n);
    expect(names).toEqual(["slow", "late"]);
  });

  it("never waits longer than its limit", async () => {
    const { timed, settled } = await load();
    void timed("forever", () => new Promise(() => undefined));
    const from = Date.now();
    expect(await settled(20, 300)).toEqual([]);
    expect(Date.now() - from).toBeLessThan(1500);
  });

  it("with the switch off nothing is measured and the read is the read", async () => {
    vi.stubEnv("SERVER_TIMING", "");
    const { timed, mark } = await load();
    const run = vi.fn(async () => 7);
    expect(await timed("x", run)).toBe(7);
    mark("y");
    expect(run).toHaveBeenCalledTimes(1);
    vi.stubEnv("SERVER_TIMING", "1"); // switched on afterwards: the collector is empty
    const { settled } = await load();
    expect(await settled(10, 100)).toEqual([]);
  });
});

describe("the header text and the span names", () => {
  it("is `name;dur=ms` with one decimal, and leaves out a name that is not ours or a value that is not a number", () => {
    expect(headerValue([["proxy_pre", 0.04], ["proxy_session", 212.345], ["bad name", 1], ["Bad", 1], ["nan", Number.NaN], ["neg", -3]])).toBe("proxy_pre;dur=0, proxy_session;dur=212.3, neg;dur=0");
    expect(headerValue([])).toBe("");
  });

  it("every span name used by the app is a plain lower-case word", () => {
    for (const n of ["session", "session_getuser", "bootstrap", "app_me", "app_pack", "app_profile", "app_shell", "tenant", "lang", "layout_reads", "briefing", "briefing_wait", "today_shell"]) expect(SPAN_NAME.test(n)).toBe(true);
    expect(SPAN_NAME.test("tenant 11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("only the workspace's own pages are measured", () => {
    expect(inTimingScope("/app/tenants/abc")).toBe(true);
    expect(inTimingScope("/app/tenants/abc/leads")).toBe(true);
    expect(inTimingScope("/app")).toBe(false);
    expect(inTimingScope("/login")).toBe(false);
  });
});
