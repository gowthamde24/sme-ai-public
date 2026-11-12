import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveCalls } from "./live-calls-store";

const T = "22222222-2222-2222-2222-222222222222";
const wire = (calls: unknown[]) => new Response(JSON.stringify({ calls, poll_after_s: 5 }), { status: 200 });
const call = { id: "33333333-3333-4333-8333-333333333331", who: "Priya", elapsed_s: 4, answered: true, source: null, can_take_over: false };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

/** Counts the asks made in `ms` more milliseconds after the first answer. */
async function asksIn(ms: number, calls: unknown[], path: string): Promise<number> {
  window.history.pushState({}, "", path);
  fetchMock.mockImplementation(async () => wire(calls));
  const { unmount } = renderHook(() => useLiveCalls(T, true));
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  fetchMock.mockClear();
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const n = fetchMock.mock.calls.length;
  unmount();
  return n;
}

describe("how often the live-call bar asks (owner, 12 Nov 2026: staging was slow under the polling)", () => {
  it("nothing live and not on a calls screen: once in 30 s, not every 5 s", async () => {
    expect(await asksIn(29_000, [], `/app/tenants/${T}/settings`)).toBe(0);
    expect(await asksIn(31_000, [], `/app/tenants/${T}/settings`)).toBe(1);
  });
  it("a call is live: every 5 s", async () => {
    expect(await asksIn(21_000, [call], `/app/tenants/${T}/settings`)).toBe(4);
  });
  it("the calls screens are open: every 5 s even with nothing live", async () => {
    expect(await asksIn(21_000, [], `/app/tenants/${T}/calls`)).toBe(4);
    expect(await asksIn(21_000, [], `/app/tenants/${T}/calls/${call.id}`)).toBe(4);
  });
  it("a failed ask is asked again later, never at once, and a Retry-After is a floor (C1's Phase 1)", async () => {
    window.history.pushState({}, "", `/app/tenants/${T}/calls`);
    fetchMock.mockImplementation(async () => new Response("Unavailable", { status: 503, headers: { "Retry-After": "40" } }));
    const { unmount } = renderHook(() => useLiveCalls(T, true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(39_000)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
