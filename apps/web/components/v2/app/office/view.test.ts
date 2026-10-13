import { afterEach, describe, expect, it, vi } from "vitest";

import { VIEW_KEY, isLite, readClientEnv, rememberView } from "./view";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("who gets still owls in the office", () => {
  it("reduced motion, the data saver and a 2G or 3G connection do; everyone else gets the moving room (the room is plain DOM and CSS: no device is too weak to draw it)", () => {
    expect(isLite({ reducedMotion: true })).toBe(true);
    expect(isLite({ reducedMotion: false, saveData: true })).toBe(true);
    for (const t of ["slow-2g", "2g", "3g"]) expect(isLite({ reducedMotion: false, effectiveType: t })).toBe(true);
    expect(isLite({ reducedMotion: false, effectiveType: "4g" })).toBe(false);
    expect(isLite({ reducedMotion: false })).toBe(false);
  });
});

describe("what the browser tells the office", () => {
  const media = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") ? reduce : false }));
  it("reads reduced motion and the remembered view; only room and list are remembered", () => {
    media(true);
    window.localStorage.setItem(VIEW_KEY, "list");
    expect(readClientEnv()).toEqual({ reducedMotion: true, lite: true, remembered: "list" });
    window.localStorage.setItem(VIEW_KEY, "3d");
    media(false);
    expect(readClientEnv()).toEqual({ reducedMotion: false, lite: false, remembered: null });
    window.localStorage.setItem(VIEW_KEY, "room");
    expect(readClientEnv().remembered).toBe("room");
  });
  it("blocked storage means nothing is remembered, and nothing throws", () => {
    media(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readClientEnv().remembered).toBeNull();
    expect(() => rememberView("list")).not.toThrow();
  });
});
