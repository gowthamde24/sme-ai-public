import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { take } from "@/lib/api/settled";

describe("take: the value of a settled read, or its own error", () => {
  it("returns the value of a read that worked", async () => {
    const [a, b] = await Promise.allSettled([Promise.resolve(1), Promise.resolve("two")]);
    expect(take(a)).toBe(1);
    expect(take(b)).toBe("two");
  });
  it("throws the very error of a read that failed, so a page's catch sees what it always saw", async () => {
    const failure = new ApiRequestError(404, "not_found", "gone");
    const [a] = await Promise.allSettled([Promise.reject(failure)]);
    expect(() => take(a)).toThrow(failure);
    try {
      take(a);
    } catch (error) {
      expect(error).toBe(failure);
      expect(error instanceof ApiRequestError && error.status).toBe(404);
    }
  });
  it("lets the first failing read in the page's own order win, as when the reads ran one after another", async () => {
    const first = new Error("tenant");
    const second = new Error("lead");
    const [t, l] = await Promise.allSettled([Promise.reject(first), Promise.reject(second)]);
    let seen: unknown = null;
    try {
      take(t);
      take(l);
    } catch (error) {
      seen = error;
    }
    expect(seen).toBe(first);
  });
  it("starts the reads at the same time: three reads of 40 ms take about 40 ms, not 120", async () => {
    const slow = (n: number) => new Promise<number>((resolve) => setTimeout(() => resolve(n), 40));
    const t0 = Date.now();
    const settled = await Promise.allSettled([slow(1), slow(2), slow(3)]);
    expect(settled.map(take)).toEqual([1, 2, 3]);
    expect(Date.now() - t0).toBeLessThan(110);
  });
});
