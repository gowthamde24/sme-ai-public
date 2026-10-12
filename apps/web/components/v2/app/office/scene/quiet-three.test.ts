import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOCK_WARNING, quietThreeClockWarning } from "./quiet-three";

describe("quietThreeClockWarning", () => {
  const original = console.warn;
  afterEach(() => {
    console.warn = original;
  });
  it("drops the one Clock deprecation message and nothing else", async () => {
    vi.resetModules();
    const seen = vi.fn();
    console.warn = seen;
    const mod = await import("./quiet-three");
    mod.quietThreeClockWarning();
    console.warn("THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.");
    console.warn("THREE.WebGLRenderer: Context Lost.");
    console.warn("something else", 3);
    expect(seen.mock.calls).toEqual([["THREE.WebGLRenderer: Context Lost."], ["something else", 3]]);
    mod.quietThreeClockWarning(); // twice is still one wrapper
    console.warn("THREE.Clock: This module has been deprecated.");
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it("is the text three prints", () => {
    expect(CLOCK_WARNING.length).toBeGreaterThan(20);
    expect(typeof quietThreeClockWarning).toBe("function");
  });
});
