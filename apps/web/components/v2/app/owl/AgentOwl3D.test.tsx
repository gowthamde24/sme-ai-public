import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentOwlSceneProps } from "./AgentOwlScene";
import { AgentOwl3D } from "./AgentOwl3D";
import type { OwlEnv } from "./owl-mode";

// jsdom has no WebGL: the scene is replaced by a stand-in that behaves the way the real one does (it reports its first frame, or its failure).
const scene = vi.hoisted(() => ({ mode: "ok" as "ok" | "fail", mounts: 0, lastMood: "" }));
vi.mock("./AgentOwlScene", () => ({
  default: function Stub({ mood, onReady, onFail }: AgentOwlSceneProps) {
    scene.lastMood = mood;
    React.useEffect(() => {
      scene.mounts++;
      if (scene.mode === "fail") onFail();
      else onReady();
    }, [onReady, onFail]);
    return <canvas data-testid="owl-canvas" />;
  },
}));

const GOOD: OwlEnv = { reducedMotion: false, cores: 8, webgl: true };
const owl = (env: OwlEnv, mood: "idle" | "thinking" = "idle") => render(<AgentOwl3D mood={mood} name="Agent OWL" moodText={mood === "idle" ? "Ready" : "Thinking"} env={env} />);
const frame = () => screen.getByRole("img", { name: /Agent OWL/ });

afterEach(() => {
  cleanup();
  scene.mode = "ok";
  scene.mounts = 0;
});

describe("AgentOwl3D: what it is", () => {
  it("is an image named Agent OWL with the mood, and the mood is also text for a screen reader", () => {
    owl({ ...GOOD, webgl: false }, "thinking");
    expect(screen.getByRole("img", { name: "Agent OWL, Thinking" })).toBeTruthy();
    expect(screen.getByText("Thinking", { selector: "span[aria-live=polite]" })).toBeTruthy();
  });
  it("is 120 px on a phone and 160 px from the sm breakpoint, from the first paint (no layout shift)", () => {
    owl({ ...GOOD, webgl: false });
    expect(frame().className).toMatch(/size-\[120px\]/);
    expect(frame().className).toMatch(/sm:size-40/);
  });
  it("the flat owl is the placeholder: it carries the mood", () => {
    owl({ ...GOOD, webgl: false }, "thinking");
    expect(frame().querySelector("svg.owl")).toHaveAttribute("data-state", "thinking");
  });
});

describe("AgentOwl3D: 3D, and the fall back to the flat owl", () => {
  it("loads the 3D scene on a capable device, and the flat owl steps aside once the first frame is drawn", async () => {
    owl(GOOD);
    expect(await screen.findByTestId("owl-canvas")).toBeTruthy();
    await waitFor(() => expect(frame()).toHaveAttribute("data-owl-render", "3d"));
    expect(frame().querySelector("svg.owl")!.getAttribute("class")).toMatch(/invisible/);
  });
  it.each([
    ["the data saver is on", { reducedMotion: false, cores: 8, webgl: true, saveData: true }],
    ["the connection is 2g", { reducedMotion: false, cores: 8, webgl: true, effectiveType: "2g" }],
    ["the connection is 3g", { reducedMotion: false, cores: 8, webgl: true, effectiveType: "3g" }],
    ["the connection is slow-2g", { reducedMotion: false, cores: 8, webgl: true, effectiveType: "slow-2g" }],
    ["the device has 2 GB of memory", { reducedMotion: false, cores: 8, webgl: true, deviceMemory: 2 }],
  ] as [string, OwlEnv][])("never downloads the 3D scene when %s, not even after the page is idle", async (_why, env) => {
    vi.useFakeTimers();
    try {
      owl(env);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(scene.mounts).toBe(0);
      expect(screen.queryByTestId("owl-canvas")).toBeNull();
      expect(frame()).toHaveAttribute("data-owl-render", "svg");
    } finally {
      vi.useRealTimers();
    }
  });
  it("starts the 3D load only when the page is idle: with requestIdleCallback, not before it fires", async () => {
    const callbacks: (() => void)[] = [];
    const ric = vi.fn((cb: () => void, opts?: { timeout: number }) => {
      callbacks.push(cb);
      expect(opts?.timeout).toBeGreaterThan(0);
      return callbacks.length;
    });
    vi.stubGlobal("requestIdleCallback", ric);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    owl(GOOD);
    await act(async () => {});
    expect(ric).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("owl-canvas")).toBeNull(); // the page is not idle yet: nothing is requested
    expect(scene.mounts).toBe(0);
    await act(async () => callbacks[0]());
    expect(await screen.findByTestId("owl-canvas")).toBeTruthy();
    vi.unstubAllGlobals();
  });
  it("without requestIdleCallback a short timer stands in, and the load is not started before it", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestIdleCallback", undefined);
      owl(GOOD);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByTestId("owl-canvas")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId("owl-canvas")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("leaving before the page is idle cancels the request (no 3D load, no state update after unmount)", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", vi.fn(() => 7));
    vi.stubGlobal("cancelIdleCallback", cancel);
    const view = owl(GOOD);
    await act(async () => {});
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(scene.mounts).toBe(0);
    vi.unstubAllGlobals();
  });
  it("gives the scene the mood it is given", async () => {
    owl(GOOD, "thinking");
    await screen.findByTestId("owl-canvas");
    expect(scene.lastMood).toBe("thinking");
  });
  it.each([
    ["WebGL is missing", { reducedMotion: false, cores: 8, webgl: false }],
    ["the device has two cores", { reducedMotion: false, cores: 2, webgl: true }],
    ["the device has one core", { reducedMotion: false, cores: 1, webgl: true }],
  ] as [string, OwlEnv][])("never loads the 3D scene when %s: the flat owl, moving", async (_why, env) => {
    owl(env);
    await act(async () => {});
    expect(screen.queryByTestId("owl-canvas")).toBeNull();
    expect(scene.mounts).toBe(0);
    expect(frame()).toHaveAttribute("data-owl-render", "svg");
    expect(frame().querySelector("svg.owl")).not.toHaveAttribute("data-still");
  });
  it("with reduced motion it is the flat owl standing still, and the 3D scene is never loaded", async () => {
    owl({ reducedMotion: true, cores: 8, webgl: true });
    await act(async () => {});
    expect(screen.queryByTestId("owl-canvas")).toBeNull();
    expect(frame()).toHaveAttribute("data-owl-render", "svg-still");
    expect(frame().querySelector("svg.owl")).toHaveAttribute("data-still", "true");
  });
  it("when the WebGL context cannot be created (or is lost) the scene reports it and the flat owl comes back", async () => {
    scene.mode = "fail";
    owl(GOOD);
    await waitFor(() => expect(frame()).toHaveAttribute("data-owl-render", "svg"));
    expect(screen.queryByTestId("owl-canvas")).toBeNull();
    expect(frame().querySelector("svg.owl")!.getAttribute("class")).not.toMatch(/invisible/);
  });
});
