import { afterEach, describe, expect, it, vi } from "vitest";

import { VIEW_KEY, defaultView, readClientEnv, rememberView } from "./capability";

const GOOD = { reducedMotion: false, saveData: false, effectiveType: "4g", deviceMemory: 8, cores: 8 };

describe("which view first", () => {
  it("a capable device is shown the room", () => {
    expect(defaultView(GOOD)).toEqual({ view: "3d", weak: false });
  });
  it("a browser that says nothing about itself is not treated as weak", () => {
    expect(defaultView({ reducedMotion: false })).toEqual({ view: "3d", weak: false });
  });
  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["data saver", { saveData: true }],
    ["2g", { effectiveType: "2g" }],
    ["slow 2g", { effectiveType: "slow-2g" }],
    ["3g", { effectiveType: "3g" }],
    ["4 GB of memory", { deviceMemory: 4 }],
    ["2 GB of memory", { deviceMemory: 2 }],
    ["4 cores", { cores: 4 }],
  ])("%s: the List", (_label, patch) => {
    expect(defaultView({ ...GOOD, ...patch })).toEqual({ view: "list", weak: true });
  });
  it("the edges are the right way round", () => {
    expect(defaultView({ ...GOOD, deviceMemory: 8, cores: 6, effectiveType: "4g" }).view).toBe("3d");
    expect(defaultView({ ...GOOD, effectiveType: "4g", deviceMemory: 4.5 as number }).view).toBe("3d");
  });
});

describe("readClientEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
  it("reads the preference for less motion and the remembered view", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("prefers-reduced-motion"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    rememberView("3d");
    const env = readClientEnv();
    expect(env.reducedMotion).toBe(true);
    expect(env.defaultView).toBe("list");
    expect(env.remembered).toBe("3d");
    expect(window.localStorage.getItem(VIEW_KEY)).toBe("3d");
  });
  it("ignores a remembered value it does not know, and storage that throws", () => {
    window.localStorage.setItem(VIEW_KEY, "<script>");
    expect(readClientEnv().remembered).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readClientEnv().remembered).toBeNull();
    vi.restoreAllMocks();
  });
  it("without matchMedia nothing is assumed", () => {
    vi.stubGlobal("matchMedia", undefined);
    const env = readClientEnv();
    expect(env.reducedMotion).toBe(false);
    expect(env.coarse).toBe(false);
  });
});
