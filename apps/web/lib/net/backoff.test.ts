import { describe, expect, it, vi } from "vitest";

import { backoffDelay, retryWithBackoff } from "./backoff";

describe("backoffDelay", () => {
  it("doubles from the base, with jitter between 85% and 115%", () => {
    expect([0, 1, 2, 3].map((n) => backoffDelay(n, { base: 1000 }, 0.5))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(0, { base: 1000 }, 0)).toBe(850);
    expect(backoffDelay(0, { base: 1000 }, 1)).toBe(1150);
  });
  it("never goes past the cap (plus its jitter)", () => {
    expect(backoffDelay(20, { base: 1000, cap: 30_000 }, 0.5)).toBe(30_000);
    expect(backoffDelay(20, { base: 1000, cap: 30_000 }, 1)).toBeLessThanOrEqual(34_500);
  });
});

describe("retryWithBackoff", () => {
  const instant = () => Promise.resolve();
  it("returns the first good answer without waiting", async () => {
    const sleep = vi.fn(instant);
    expect(await retryWithBackoff(async () => "ok", { sleep })).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });
  it("tries again after a failure, with a longer wait each time", async () => {
    const waits: number[] = [];
    let n = 0;
    const out = await retryWithBackoff(
      async () => {
        n += 1;
        if (n < 3) throw new Error("down");
        return n;
      },
      { tries: 3, base: 1000, random: () => 0.5, sleep: async (ms) => void waits.push(ms) },
    );
    expect(out).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });
  it("gives up after the tries and throws the last failure", async () => {
    const run = vi.fn(async (a: number) => {
      throw new Error(`fail ${a}`);
    });
    await expect(retryWithBackoff(run, { tries: 3, sleep: instant })).rejects.toThrow("fail 2");
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("does not retry what is not worth it, nor an abort", async () => {
    const run = vi.fn(async () => {
      throw new Error("403");
    });
    await expect(retryWithBackoff(run, { tries: 5, shouldRetry: () => false, sleep: instant })).rejects.toThrow("403");
    expect(run).toHaveBeenCalledTimes(1);
    const aborted = vi.fn(async () => {
      throw new DOMException("x", "AbortError");
    });
    await expect(retryWithBackoff(aborted, { tries: 5, sleep: instant })).rejects.toThrow();
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
