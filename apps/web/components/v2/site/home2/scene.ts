/**
 * The home page's one drawing loop (landing v2, job landing-v2 part C): every canvas scene registers here, and ONE requestAnimationFrame paints the scenes that are on screen (an IntersectionObserver per canvas pauses the others).
 * The device pixel ratio is capped at 2. With "reduce motion" each scene draws one still frame (and again when its size changes), and nothing loops. The orbs are the product's own AssistantOrb, which keeps its own loop.
 * Client only; no React. The theme is read from the v2 root (`data-theme`, or the system's preference when the page follows it) so a scene can use the dark tokens' colours.
 */
export type SceneDraw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, look: Look) => void;
/** What a scene needs to know about the page: dark theme, still (reduced motion), the ratio it draws at. */
export type Look = { dark: boolean; calm: boolean; dpr: number };

type Scene = { el: HTMLCanvasElement; draw: SceneDraw; visible: boolean; ctx: CanvasRenderingContext2D };

const scenes = new Set<Scene>();
let frame = 0;
let start = 0;
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;

export const isCalm = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
export function isDark(el: Element): boolean {
  const root = el.closest('[data-ui="v2"]');
  const theme = root?.getAttribute("data-theme");
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}
/** Seconds since the page's scenes started (the same clock for every scene and island). */
export const sceneTime = (): number => (start ? (performance.now() - start) / 1000 : 0);

function paint(s: Scene, now: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round((s.el.clientWidth || 1) * dpr);
  const h = Math.round((s.el.clientHeight || 1) * dpr);
  if (s.el.width !== w || s.el.height !== h) {
    s.el.width = w;
    s.el.height = h;
  }
  const calm = isCalm();
  s.draw(s.ctx, w, h, calm ? 1.3 : (now - start) / 1000, { dark: isDark(s.el), calm, dpr });
}

function loop(now: number): void {
  for (const s of scenes) if (s.visible) paint(s, now);
  frame = scenes.size ? requestAnimationFrame(loop) : 0;
}

/** Registers a canvas: it is painted while on screen. Returns the function that removes it. */
export function addScene(el: HTMLCanvasElement, draw: SceneDraw): () => void {
  const ctx = el.getContext("2d");
  if (!ctx) return () => undefined;
  if (!start) start = performance.now();
  const s: Scene = { el, draw, visible: true, ctx };
  scenes.add(s);
  const calm = isCalm();
  if (typeof IntersectionObserver !== "undefined" && !io)
    io = new IntersectionObserver((es) => {
      for (const e of es) for (const sc of scenes) if (sc.el === e.target) sc.visible = e.isIntersecting;
    });
  io?.observe(el);
  if (typeof ResizeObserver !== "undefined" && !ro)
    ro = new ResizeObserver((es) => {
      if (!isCalm()) return;
      for (const e of es) for (const sc of scenes) if (sc.el === e.target) paint(sc, performance.now());
    });
  ro?.observe(el);
  paint(s, performance.now());
  if (!calm && !frame) frame = requestAnimationFrame(loop);
  return () => {
    scenes.delete(s);
    io?.unobserve(el);
    ro?.unobserve(el);
    if (!scenes.size && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/** A voice spectrum: bars standing out from a circle, taller while speaking (`amp`); `boot` 0..1 grows them in at the start. */
export function spectrum(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, amp: number, t: number, n: number, boot: number): void {
  const TAU = 6.2832;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    const nz = 0.5 + 0.5 * Math.sin(i * 0.73 + t * 7.1) * Math.sin(i * 0.29 - t * 4.3) + 0.25 * Math.sin(i * 1.9 + t * 11);
    const len = (2 + amp * Math.max(0.08, nz)) * boot;
    const al = 0.25 + 0.6 * Math.max(0, nz);
    ctx.strokeStyle = `rgba(${i % 2 ? "255,119,60" : "236,72,110"},${al})`;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    ctx.stroke();
  }
}

/** A point on a cubic Bézier curve. */
export type Pt = [number, number];
export function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const v = 1 - u;
  return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]];
}
/** The ink of a scene's lines in the page's theme (the v2 tokens' ink, light on dark). */
export const inkOf = (look: Look): string => (look.dark ? "244,242,238" : "30,30,36");

/** The page's own font for a canvas: next/font gives each family a generated name, so a canvas asks the v2 root for it (`--v2-font-display`, `--v2-font-sans`) instead of naming "Bricolage Grotesque" (which would fall back to the system font). */
export function fontOf(el: Element, kind: "display" | "sans"): string {
  const root = el.closest('[data-ui="v2"]') ?? document.documentElement;
  const v = getComputedStyle(root).getPropertyValue(kind === "display" ? "--v2-font-display" : "--v2-font-sans").trim();
  return v || (kind === "display" ? '"Bricolage Grotesque", system-ui, sans-serif' : '"Plus Jakarta Sans", system-ui, sans-serif');
}
