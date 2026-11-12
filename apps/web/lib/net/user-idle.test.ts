import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_AFTER_MS, resetUserIdleForTests, userIdle, whenUserBack } from "./user-idle";

beforeEach(() => {
  vi.useFakeTimers();
  resetUserIdleForTests();
});
afterEach(() => vi.useRealTimers());

describe("a tab in front that nobody touches", () => {
  it("is idle only after ten quiet minutes, and a touch makes it active again", () => {
    expect(userIdle()).toBe(false);
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1000);
    expect(userIdle()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(userIdle()).toBe(true);
    window.dispatchEvent(new Event("pointerdown"));
    expect(userIdle()).toBe(false);
  });
  it("the first touch after a long quiet wakes whoever waits, once per key; a touch while active wakes nobody", () => {
    const a = vi.fn();
    const b = vi.fn();
    whenUserBack("a", a);
    whenUserBack("b", b);
    whenUserBack("a", a); // (one waiting call per key)
    window.dispatchEvent(new Event("keydown")); // (active: nothing to wake)
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_AFTER_MS + 1000);
    window.dispatchEvent(new Event("wheel"));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pointerdown"));
    expect(a).toHaveBeenCalledTimes(1);
  });
});
