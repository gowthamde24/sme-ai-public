import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_COUNTS, parseNavCounts } from "@/lib/nav-counts";

import { POLL_MS, resetNavCountsForTests, useNavCounts } from "./use-nav-counts";

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
