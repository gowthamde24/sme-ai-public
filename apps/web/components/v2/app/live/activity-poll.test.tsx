import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_AFTER_MS, resetUserIdleForTests } from "@/lib/net/user-idle";

import { useActivity } from "./activity-poll";

const T = "22222222-2222-2222-2222-222222222222";
const item = { type: "call", who: "Priya", elapsed_s: 4, target: null };
const wire = (items: unknown[], pollAfterS = 10) => new Response(JSON.stringify({ items, poll_after_s: pollAfterS }), { status: 200 });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  resetUserIdleForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The asks made in the `ms` after the first answer. */
async function asksIn(ms: number, items: unknown[]): Promise<number> {
  fetchMock.mockImplementation(async () => wire(items));
  const { unmount } = renderHook(() => useActivity(T, true));
  await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
  fetchMock.mockClear();
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const n = fetchMock.mock.calls.length;
  unmount();
  return n;
}

describe("how often the live strip asks (polling backoff, 12 Nov 2026)", () => {
  it("something is happening: at the API's own pace (every 10 s)", async () => {
    expect(await asksIn(61_000, [item])).toBe(6);
  });
  it("nothing happening: 10 s for the first three answers, then every 30 s, then every minute", async () => {
    expect(await asksIn(25_000, [])).toBe(2); // (answers 2 and 3 at 10 s and 20 s; the first came before the count)
    // after 3 empty answers the gap is 30 s, after 9 a minute: in ten minutes it asks far fewer times than the 60 a steady 10 s would
    expect(await asksIn(600_000, [])).toBeLessThan(20);
  });
  it("after ten minutes without a touch it stops asking, and the first touch asks again at once", async () => {
    fetchMock.mockImplementation(async () => wire([item]));
    const { unmount } = renderHook(() => useActivity(T, true));
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS + 30_000)));
    fetchMock.mockClear();
    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)));
    expect(fetchMock).not.toHaveBeenCalled(); // (nobody is looking)
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });
});
