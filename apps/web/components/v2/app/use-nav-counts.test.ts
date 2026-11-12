import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_COUNTS, parseNavCounts } from "@/lib/nav-counts";

import { MAX_HOLD_MS, POLL_MS, resetNavCountsForTests, useNavCounts } from "./use-nav-counts";

const T = "11111111-1111-4111-8111-111111111111";
const answer = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const tick = (ms = 5) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  resetNavCountsForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the menu's numbers in the browser (one shared poll)", () => {
  it("asks once after the first paint for every part that draws them, then every 30 seconds; a failed ask keeps the last numbers", async () => {
    const fetchMock = vi.fn(async () => answer({ counts: parseNavCounts({ needs_you: 4, new_leads: 12 }) }));
    vi.stubGlobal("fetch", fetchMock);
    const a = renderHook(() => useNavCounts(T));
    const b = renderHook(() => useNavCounts(T));
    expect(a.result.current).toEqual(NO_COUNTS); // nothing before the first answer: no badge
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.result.current.newLeads).toBe(12);
    expect(b.result.current.newLeads).toBe(12);
    fetchMock.mockImplementation(async () => answer("Unavailable", 503));
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a.result.current.newLeads).toBe(12);
    a.unmount();
    b.unmount();
  });
  it("outside a workspace nothing is asked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useNavCounts(null));
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toEqual(NO_COUNTS);
  });
});

describe("after a failed ask the menu waits longer (C1's Phase 1: back off on any 5xx, honour Retry-After)", () => {
  it("each failure doubles the wait (a minute, two, four ... up to five), a Retry-After is a floor, and one good answer starts over", async () => {
    const fetchMock = vi.fn(async () => answer("Unavailable", 503));
    vi.stubGlobal("fetch", fetchMock);
    const a = renderHook(() => useNavCounts(T));
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1); // failed: next after 1 minute
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2); // failed again: next after 2 minutes
    await tick(POLL_MS * 2 - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(MAX_HOLD_MS).toBe(300_000);
    fetchMock.mockImplementation(async () => answer({ counts: parseNavCounts({ new_leads: 3 }) }));
    await tick(POLL_MS * 4);
    expect(a.result.current.newLeads).toBe(3);
    const calls = fetchMock.mock.calls.length;
    await tick(POLL_MS);
    expect(fetchMock.mock.calls.length).toBe(calls + 1); // back to every minute
    a.unmount();
  });
  it("a Retry-After longer than the backoff is waited out", async () => {
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503, headers: { "Retry-After": "170" } }));
    vi.stubGlobal("fetch", fetchMock);
    const a = renderHook(() => useNavCounts(T));
    await tick();
    await tick(POLL_MS * 2); // two minutes: still held (170 s)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    a.unmount();
  });
});

