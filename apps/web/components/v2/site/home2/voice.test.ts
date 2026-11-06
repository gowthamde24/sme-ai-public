import { afterEach, describe, expect, it, vi } from "vitest";

import { parseManifest, playable } from "./voice";

const clip = (over: Record<string, unknown> = {}) => ({ group: "hero", speaker: "f", lang: "te", text: "నమస్కారం", duration: 1.2, words: [{ w: "నమస్కారం", start: 0, end: 1.2 }], sources: [{ src: "/audio/site/hero-te.mp3", type: "audio/mpeg" }], ...over });

describe("the site's voice manifest (owner rule, 6 Nov 2026: a clip waiting for review gets no Hear it)", () => {
  it("plays a clip only when the manifest says draft: false in so many words", () => {
    const m = parseManifest({ version: 1, groups: { hero: ["a", "b", "c"] }, clips: { a: clip({ draft: false }), b: clip({ draft: true }), c: clip() } });
    expect(playable(m, "a")).toBe(true);
    expect(playable(m, "b")).toBe(false);
    // no draft field at all: it waits for review
    expect(playable(m, "c")).toBe(false);
    expect(playable(m, "missing")).toBe(false);
    expect(playable(null, "a")).toBe(false);
  });

  it("keeps only sound files under /audio/site/ and drops a clip id it cannot trust", () => {
    const m = parseManifest({
      version: 1,
      groups: { hero: ["ok", "Bad Id!", "away"] },
      clips: { ok: clip({ draft: false }), "Bad Id!": clip({ draft: false }), away: clip({ draft: false, sources: [{ src: "https://elsewhere.example/x.mp3", type: "audio/mpeg" }, { src: "/audio/site/../../secret", type: "audio/mpeg" }] }) },
    });
    expect(Object.keys(m?.clips ?? {})).toEqual(["ok", "away"]);
    expect(m?.groups.hero).toEqual(["ok", "away"]);
    // a clip with no sound file left is never offered
    expect(playable(m, "away")).toBe(false);
  });

  it("reads nothing from a manifest that is not one", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("x")).toBeNull();
    expect(parseManifest({ clips: {} })).toBeNull();
  });
});

describe("loadManifest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("cancels a missing manifest's answer (the site's 404 page), so the page goes quiet, and offers no voice", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 404, body: { cancel } })));
    const { loadManifest } = await import("./voice");
    await expect(loadManifest()).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("reads the manifest once per page", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 2, groups: {}, clips: { a: clip({ draft: false }) } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadManifest } = await import("./voice");
    const [m1, m2] = await Promise.all([loadManifest(), loadManifest()]);
    expect(m1?.version).toBe(2);
    expect(m2).toBe(m1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers no voice when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const { loadManifest } = await import("./voice");
    await expect(loadManifest()).resolves.toBeNull();
  });
});
