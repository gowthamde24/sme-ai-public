import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOwl } from "./AgentOwl";
import { LAYER_DELAY_MS, PlushOwl } from "./PlushOwl";
import { owlMood } from "./owl-mood";

// ---- what the server sends (and what a browser with no script shows) ------------------------------------------------------------------------------------------------------------------------------
describe("PlushOwl from the server: one still picture, with the owl's name", () => {
  const html = renderToStaticMarkup(<PlushOwl mood="idle" label="Agent OWL, ready" size={160} />);
  it("is the still in three sizes (the browser takes one by the size it is drawn at), in a square box with its size given, with the same name as alt text", () => {
    expect(html).toContain('src="/owl/v2/owlet-full-256.webp"');
    expect(html).toContain('srcSet="/owl/v2/owlet-full-128.webp 128w, /owl/v2/owlet-full-256.webp 256w, /owl/v2/owlet-full-512.webp 512w"');
    expect(html).toContain('sizes="160px"');
    expect(html).toContain('width="512"');
    expect(html).toContain('height="512"');
    expect(html).toContain('alt="Agent OWL, ready"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("width:160px;height:160px");
  });
  it("takes the sizes it is given (the Agent OWL: 120 px on a phone, 160 px from 640 px up)", () => {
    expect(renderToStaticMarkup(<AgentOwl mood="idle" name="Agent OWL" moodText="ready" />)).toContain('sizes="(min-width: 640px) 160px, 120px"');
  });
  it("is an image with the name, and nothing of the layers is in it", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Agent OWL, ready"');
    for (const layer of ["owlet-head", "owlet-body", "owlet-beak", "owlet-wing"]) expect(html).not.toContain(layer);
    expect(html).not.toContain("<canvas");
    expect(html).toContain('data-plush="still"');
  });
  it("without a label it is decorative: hidden from screen readers, empty alt", () => {
    const d = renderToStaticMarkup(<PlushOwl mood="idle" />);
    expect(d).toContain('aria-hidden="true"');
    expect(d).not.toContain('role="img"');
    expect(d).toContain('alt=""');
  });
  it("the thinking dots and the z z z are aria-hidden, and each shows only in its own mood", () => {
    const thinking = renderToStaticMarkup(<PlushOwl mood="thinking" label="x" />);
    const resting = renderToStaticMarkup(<PlushOwl mood="resting" label="x" />);
    const idle = renderToStaticMarkup(<PlushOwl mood="idle" label="x" />);
    expect(thinking).toMatch(/class="plush-bubble" data-on="true" aria-hidden="true"/);
    expect(thinking).not.toMatch(/plush-zz" data-on/);
    expect(resting).toMatch(/class="plush-zz" data-on="true" aria-hidden="true"/);
    expect(resting).not.toMatch(/plush-bubble" data-on/);
    expect(idle).not.toMatch(/data-on/);
  });
  it("carries the mood for styles and tests", () => {
    for (const m of ["idle", "listening", "thinking", "answering", "resting"] as const) expect(renderToStaticMarkup(<PlushOwl mood={m} />)).toContain(`data-mood="${m}"`);
  });
});

// ---- the mood the Ask box gives it: the existing mapping, unchanged ---------------------------------------------------------------------------------------------------------------------------
describe("the mood mapping the owl is driven by (the Ask box's own state, unchanged by job CI)", () => {
  const base = { live: true, typing: false, phase: "idle" as const, hasText: false };
  it("maps the agent states and SSE phases to the five moods", () => {
    expect(owlMood({ ...base, live: false })).toBe("resting");
    expect(owlMood({ ...base, phase: "error", errorCode: "ai_paused_until" })).toBe("resting");
    expect(owlMood(base)).toBe("idle");
    expect(owlMood({ ...base, typing: true })).toBe("listening");
    expect(owlMood({ ...base, micOn: true })).toBe("listening");
    expect(owlMood({ ...base, phase: "asking" })).toBe("thinking");
    expect(owlMood({ ...base, phase: "asking", hasText: true })).toBe("answering");
    expect(owlMood({ ...base, speaking: true })).toBe("answering");
  });
});

// ---- in a browser ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
type IoCallback = (entries: { isIntersecting: boolean }[]) => void;
let io: { cb: IoCallback; observed: Element[]; disconnected: boolean } | null = null;
let rafCalls = 0;
let rafCancelled = 0;
let wingImages: { onload?: () => void; onerror?: () => void; src?: string }[] = [];
let media: { matches: boolean; listeners: (() => void)[] };

function stubBrowser(opts: { reduced?: boolean } = {}) {
  media = { matches: Boolean(opts.reduced), listeners: [] };
  vi.stubGlobal("matchMedia", (q: string) => ({ get matches() { return q.includes("reduce") ? media.matches : false; }, addEventListener: (_: string, f: () => void) => media.listeners.push(f), removeEventListener: () => undefined }));
  io = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      cb: IoCallback;
      constructor(cb: IoCallback) {
        this.cb = cb;
        io = { cb, observed: [], disconnected: false };
      }
      observe(el: Element) {
        io?.observed.push(el);
      }
      disconnect() {
        if (io) io.disconnected = true;
      }
    },
  );
  vi.stubGlobal("requestIdleCallback", (f: () => void) => {
    f();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => undefined);
  rafCalls = 0;
  rafCancelled = 0;
  vi.stubGlobal("requestAnimationFrame", () => ++rafCalls); // never fires the frame: the test only counts that the loop is on
  vi.stubGlobal("cancelAnimationFrame", () => void rafCancelled++);
  wingImages = [];
  vi.stubGlobal(
    "Image",
    class {
      onload?: () => void;
      onerror?: () => void;
      decoding = "";
      src = "";
      constructor() {
        wingImages.push(this);
      }
    },
  );
  const fakeCtx = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
  // every <img> counts as loaded, as if it came from the cache
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 512 });
}
const intersect = async (isIntersecting: boolean) => {
  await act(async () => io?.cb([{ isIntersecting }]));
  if (isIntersecting) await act(async () => void (await vi.advanceTimersByTimeAsync(LAYER_DELAY_MS + 50))); // the layers wait a moment after the page has loaded
};
const loadWings = () => act(async () => wingImages.forEach((i) => i.onload?.()));
const stage = (c: HTMLElement) => c.querySelector<HTMLElement>(".plush")!.dataset.plush;

describe("PlushOwl in the browser", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubBrowser();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as { complete?: unknown }).complete;
    delete (HTMLImageElement.prototype as { naturalWidth?: unknown }).naturalWidth;
  });

  it("stays the still picture, and fetches no layer, until the owl is on screen", async () => {
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    expect(stage(container)).toBe("still");
    expect(container.querySelector('img[src*="owlet-head"]')).toBeNull();
    expect(wingImages).toHaveLength(0);
    expect(io?.observed).toHaveLength(1);
  });

  it("waits for the still picture, the end of the page's loading and a moment, so the layers never compete with the first paint", async () => {
    const real = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => false }); // the still is not in yet
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" priority />);
    await act(async () => io?.cb([{ isIntersecting: true }]));
    await act(async () => void (await vi.advanceTimersByTimeAsync(LAYER_DELAY_MS * 3)));
    expect(stage(container)).toBe("still");
    expect(wingImages).toHaveLength(0); // nothing asked for while the still is on its way
    Object.defineProperty(HTMLImageElement.prototype, "complete", real!);
    await act(async () => void container.querySelector(".plush-still")!.dispatchEvent(new Event("load")));
    await act(async () => void (await vi.advanceTimersByTimeAsync(LAYER_DELAY_MS - 100)));
    expect(wingImages).toHaveLength(0); // the moment has not passed yet
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(wingImages).toHaveLength(2);
    expect(stage(container)).toBe("loading");
  });

  it("the first owl on a page (priority) fetches its still at once and at high priority; any other is lazy", () => {
    const eager = renderToStaticMarkup(<PlushOwl mood="idle" label="x" priority />);
    expect(eager).toContain('loading="eager"');
    expect(eager.toLowerCase()).toContain('fetchpriority="high"');
    const lazy = renderToStaticMarkup(<PlushOwl mood="idle" label="x" />);
    expect(lazy).toContain('loading="lazy"');
    expect(lazy.toLowerCase()).not.toContain("fetchpriority");
  });

  it("when it comes on screen it fetches the layers (lazy, with width and height), and shows the live owl once all are in", async () => {
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    expect(stage(container)).toBe("loading");
    const layers = ["head", "body", "beak"].map((n) => container.querySelector<HTMLImageElement>(`img[src="/owl/v2/owlet-${n}-512.webp"]`));
    for (const img of layers) {
      expect(img).not.toBeNull();
      expect(img!.getAttribute("loading")).toBe("lazy");
      expect(img!.getAttribute("width")).toBe("512");
      expect(img!.getAttribute("height")).toBe("512");
      expect(img!.getAttribute("alt")).toBe("");
    }
    expect(wingImages.map((i) => i.src).sort()).toEqual(["/owl/v2/owlet-wing-left-512.webp", "/owl/v2/owlet-wing-right-512.webp"]);
    await loadWings();
    expect(stage(container)).toBe("live");
    expect(container.querySelector(".plush-still")?.getAttribute("data-hidden")).toBe("true");
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("cuts each wing out of its 512 px layer with the rig's 1024-space box halved (the layers are half the size of the rig's space)", async () => {
    render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    await loadWings();
    const ctx = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0].value as { drawImage: ReturnType<typeof vi.fn> };
    // the left wing box is x 160 to 302 and y 440 to 818 in the rig's space
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 80, 220, 71, 189, 0, 0, 71, 189);
  });

  it("keeps the still picture if a layer fails", async () => {
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    await act(async () => wingImages[0].onerror?.());
    expect(stage(container)).toBe("still");
    expect(container.querySelector(".plush-live")).toBeNull();
    expect(container.querySelector(".plush-still")?.getAttribute("data-hidden")).toBeNull();
  });

  it("the animation loop runs only while the owl is on screen and the tab is visible", async () => {
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    await loadWings();
    expect(stage(container)).toBe("live");
    expect(rafCalls).toBeGreaterThan(0);
    // scrolled away: the loop is cancelled
    const before = rafCancelled;
    await intersect(false);
    expect(rafCancelled).toBeGreaterThan(before);
    const callsWhileAway = rafCalls;
    await act(async () => void 0);
    expect(rafCalls).toBe(callsWhileAway); // nothing asks for a new frame
    // back on screen: it starts again
    await intersect(true);
    expect(rafCalls).toBeGreaterThan(callsWhileAway);
    // the tab is hidden: cancelled again
    const c2 = rafCancelled;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(rafCancelled).toBeGreaterThan(c2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
  });

  it("stops observing and cancels the loop when it is removed", async () => {
    const { unmount } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    await loadWings();
    const c = rafCancelled;
    unmount();
    expect(rafCancelled).toBeGreaterThan(c);
    expect(io?.disconnected).toBe(true);
  });

  it("a change of mood changes the markup (the dots, the z z z) and does not restart the loop", async () => {
    const { container, rerender } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    await intersect(true);
    await loadWings();
    const frames = rafCalls;
    const cancelled = rafCancelled;
    rerender(<PlushOwl mood="thinking" label="Agent OWL" />);
    expect(container.querySelector(".plush-bubble")?.getAttribute("data-on")).toBe("true");
    rerender(<PlushOwl mood="resting" label="Agent OWL" />);
    expect(container.querySelector(".plush-zz")?.getAttribute("data-on")).toBe("true");
    expect(container.querySelector<HTMLElement>(".plush")!.dataset.mood).toBe("resting");
    expect(rafCancelled).toBe(cancelled);
    expect(rafCalls).toBe(frames);
  });
});

describe("prefers-reduced-motion", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("is read, and followed when the setting changes", async () => {
    stubBrowser({ reduced: true });
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    expect(container.querySelector<HTMLElement>(".plush")!.dataset.motion).toBe("reduced");
    media.matches = false;
    await act(async () => media.listeners.forEach((f) => f()));
    expect(container.querySelector<HTMLElement>(".plush")!.dataset.motion).toBe("full");
  });
  it("is full motion by default", () => {
    stubBrowser();
    const { container } = render(<PlushOwl mood="idle" label="Agent OWL" />);
    expect(container.querySelector<HTMLElement>(".plush")!.dataset.motion).toBe("full");
  });
});

describe("AgentOwl: the owl of the Ask box, Today and the landing page", () => {
  beforeEach(() => stubBrowser());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("is an image named with the owl's name and its mood, and the mood is also text for a screen reader", () => {
    render(<AgentOwl mood="thinking" name="Agent OWL" moodText="Thinking" />);
    expect(screen.getByRole("img", { name: "Agent OWL, Thinking" })).toBeInTheDocument();
    expect(screen.getByText("Thinking", { selector: "span.sr-only" })).toHaveAttribute("aria-live", "polite");
  });
  it("is 120 px on a phone and 160 px from the sm breakpoint, as the 3D owl was, and its class can change that", () => {
    const { container } = render(<AgentOwl mood="idle" name="Agent OWL" moodText="Ready" className="md:size-[220px]" />);
    const cls = container.querySelector(".plush")!.className;
    expect(cls).toContain("size-[120px]");
    expect(cls).toContain("sm:size-40");
    expect(cls).toContain("md:size-[220px]");
  });
});
