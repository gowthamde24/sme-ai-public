"use client";

import * as React from "react";

import type { OwlMood } from "./owl-mood";
import {
  BLINK_SECONDS,
  EYES,
  FLUTTER_SECONDS,
  LAYER_PX,
  OWL_FILES,
  REST_POSE,
  SHUT_ARC,
  STILL_PX,
  WING_LEFT,
  WING_RIGHT,
  beakTarget,
  ease,
  flutterAngle,
  motionScale,
  nextBlinkIn,
  pointerLook,
  poseTarget,
  talkRate,
  meshFor,
  triangleMatrix,
  wanderLook,
  wingGrid,
  wingTargets,
  wingTriangles,
  type MeshSize,
  type Pose,
  type Wing,
} from "./plush-rig";

/**
 * The layered owlet (123 KB of pictures) is requested only after the still picture is in, the page has finished loading, a moment has passed and the browser is idle (requestIdleCallback; a short timer where it
 * has none), and only while the owl is on screen: it never competes with the first paint or with the still, which is the owl on a slow phone until then.
 */
export const LAYER_DELAY_MS = 1200;
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_MS = 200;
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}

/** The wings are redrawn at most about 30 times a second: 336 small triangles a frame is the one costly thing here, and a wing is slow. */
const WING_FRAME_MS = 33;
const POINTER_FRESH_MS = 3000;

type Crops = { l: HTMLCanvasElement; r: HTMLCanvasElement };

/** A picture of one wing, cut out of its 1024 x 1024 layer: the mesh only ever draws from this box, never from the whole layer. */
function cropWing(img: HTMLImageElement, wing: Wing): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = wing.x1 - wing.x0;
  c.height = wing.y1 - wing.y0;
  c.getContext("2d")?.drawImage(img, wing.x0, wing.y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function drawWing(ctx: CanvasRenderingContext2D, crop: HTMLCanvasElement, wing: Wing, deg: number, scale: number, mesh: MeshSize) {
  for (const tri of wingTriangles(wingGrid(wing, deg, mesh))) {
    const s = tri.map((p) => [p.src[0] - wing.x0, p.src[1] - wing.y0] as [number, number]);
    const d = tri.map((p) => [p.dst[0] * scale, p.dst[1] * scale] as [number, number]);
    // each drawn triangle is pushed out by a little under a pixel, so no seam shows between neighbours
    const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
    const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    const e = d.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      return [x + (dx / l) * 0.9, y + (dy / l) * 0.9] as [number, number];
    });
    const m = triangleMatrix(s[0], s[1], s[2], d[0], d[1], d[2]);
    if (!m) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(e[0][0], e[0][1]);
    ctx.lineTo(e[1][0], e[1][1]);
    ctx.lineTo(e[2][0], e[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(crop, 0, 0);
    ctx.restore();
  }
}

export type PlushOwlProps = {
  mood: OwlMood;
  /** A fixed size in CSS pixels. Without it the owl is as big as `className` makes it (always a square: it never changes size when the layers arrive). */
  size?: number;
  /** The owl is the first thing on the page (the landing hero, the Today card): its still picture is fetched at once, at high priority, instead of lazily. */
  priority?: boolean;
  className?: string;
  /** The name a screen reader says (the box is an image with this name). Without it the owl is decorative and hidden from them. */
  label?: string;
};

/**
 * The plush owlet (job CI), the Agent OWL. From the server, and with no script, it is one still picture (owlet-full-512.webp) in a square box. In the browser, once the page is idle and the owl is on screen,
 * the layers (head, body, beak, two wings) are fetched and the owl comes alive on plain DOM and CSS plus one small canvas for the wings: it breathes, blinks, follows the pointer and acts out the five moods the
 * Ask box gives it (idle, listening, thinking, answering, resting). The animation runs only while the owl is on screen and the tab is visible. With prefers-reduced-motion every movement is a third as big and
 * there are no wing flutter bursts. The thinking dots and the "z z z" are hidden from screen readers. Numbers: plush-rig.ts; styles: design/owl.css.
 */
export function PlushOwl({ mood, size, priority = false, className = "", label }: PlushOwlProps) {
  const [visible, setVisible] = React.useState(false);
  const [tabHidden, setTabHidden] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);

  const root = React.useRef<HTMLDivElement>(null);
  const still = React.useRef<HTMLImageElement>(null);
  const rig = React.useRef<HTMLDivElement>(null);
  const head = React.useRef<HTMLDivElement>(null);
  const beak = React.useRef<HTMLDivElement>(null);
  const mouth = React.useRef<HTMLDivElement>(null);
  const shadow = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const layers = React.useRef<Record<string, HTMLImageElement | null>>({});
  const wings = React.useRef<{ l: HTMLImageElement; r: HTMLImageElement } | null>(null);
  const crops = React.useRef<Crops | null>(null);
  const moodRef = React.useRef(mood);
  const reducedRef = React.useRef(reduced);
  // the loop reads the mood and the motion setting from here, so a change never restarts it
  React.useEffect(() => {
    moodRef.current = mood;
    reducedRef.current = reduced;
  }, [mood, reduced]);

  // less motion: read once, and follow the setting if it changes
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener?.("change", sync);
    return () => q.removeEventListener?.("change", sync);
  }, []);

  // on screen? and is the tab visible?
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => setVisible(entries[entries.length - 1]?.isIntersecting ?? false), { rootMargin: "120px" });
      io.observe(el);
    }
    // a browser without IntersectionObserver counts the owl as on screen
    const noIo = io === null ? window.setTimeout(() => setVisible(true), 0) : 0;
    const onVis = () => setTabHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(noIo);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // the layers are requested once: the owl is on screen, its still picture is in, the page has loaded, a moment has passed and the browser is idle
  React.useEffect(() => {
    if (armed || failed || !visible) return;
    let off: (() => void) | null = null;
    let gone = false;
    const cleanups: (() => void)[] = [];
    const once = (target: EventTarget, type: string, run: () => void) => {
      target.addEventListener(type, run, { once: true });
      cleanups.push(() => target.removeEventListener(type, run));
    };
    const idle = () => {
      if (gone) return;
      const timer = window.setTimeout(() => {
        if (!gone) off = whenIdle(() => !gone && setArmed(true));
      }, LAYER_DELAY_MS);
      cleanups.push(() => window.clearTimeout(timer));
    };
    const pageLoaded = () => (document.readyState === "complete" ? idle() : once(window, "load", idle));
    const img = still.current;
    if (!img || img.complete) pageLoaded();
    else {
      once(img, "load", pageLoaded);
      once(img, "error", pageLoaded);
    }
    return () => {
      gone = true;
      cleanups.forEach((c) => c());
      off?.();
    };
  }, [armed, failed, visible]);

  const checkReady = React.useCallback(() => {
    const L = layers.current;
    const done = (i: HTMLImageElement | null | undefined) => Boolean(i && i.complete && i.naturalWidth > 0);
    if (done(L.head) && done(L.body) && done(L.beak) && wings.current && crops.current) setReady(true);
  }, []);

  // the two wing pictures: plain Image objects, cut down to their boxes once they are in
  React.useEffect(() => {
    if (!armed || failed) return;
    let gone = false;
    const l = new Image();
    const r = new Image();
    let n = 0;
    const one = () => {
      if (gone || ++n < 2) return;
      wings.current = { l, r };
      crops.current = { l: cropWing(l, WING_LEFT), r: cropWing(r, WING_RIGHT) };
      checkReady();
    };
    l.onload = r.onload = one;
    l.onerror = r.onerror = () => !gone && setFailed(true);
    l.decoding = r.decoding = "async";
    l.src = OWL_FILES.wingLeft;
    r.src = OWL_FILES.wingRight;
    return () => {
      gone = true;
    };
  }, [armed, failed, checkReady]);
  React.useEffect(() => {
    if (armed) checkReady(); // layers that came from the cache before their handlers were attached
  }, [armed, checkReady]);

  // the loop: only while the owl is ready, on screen and the tab is visible
  const running = ready && visible && !tabHidden && !failed;
  React.useEffect(() => {
    if (!running) return;
    const el = root.current;
    const g = canvas.current;
    const c = crops.current;
    if (!el || !g || !c) return;
    const ctx = g.getContext("2d");
    let scale = 1;
    let mesh = meshFor(0);
    const fit = () => {
      const px = Math.max(128, Math.min(LAYER_PX, Math.round(el.clientWidth * Math.min(window.devicePixelRatio || 1, 2))));
      if (g.width !== px) g.width = g.height = px;
      scale = g.width / LAYER_PX;
      mesh = meshFor(g.width);
    };
    fit();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    ro?.observe(el);

    const ups = el.querySelectorAll<HTMLElement>(".plush-lid-up");
    const los = el.querySelectorAll<HTMLElement>(".plush-lid-lo");
    const shuts = el.querySelectorAll<SVGElement>(".plush-shut");
    let P: Pose = { ...REST_POSE };
    const W = { l: 0, r: 0 };
    const ptr = { look: { x: 0, y: 0 }, at: -1e9, cx: 0, cy: 0 };
    const wander = { x: 0, y: 0, until: 0 };
    let t = 0;
    let talk = 0;
    let beakNow = 0;
    let blinkT = -1;
    let nextBlink = 1.5;
    let flutterT = -1;
    let flutterNext = 3;
    let lastMood: OwlMood = moodRef.current;
    let lastWing = 0;
    let last = performance.now();
    let raf = 0;
    let stopped = false;

    const onMove = (e: PointerEvent) => {
      ptr.cx = e.clientX;
      ptr.cy = e.clientY;
      ptr.at = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const tick = (now: number) => {
      if (stopped) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      const mood = moodRef.current;
      const m = motionScale(reducedRef.current);
      if (mood !== lastMood) {
        if (!reducedRef.current && (mood === "answering" || mood === "listening")) flutterT = 0;
        lastMood = mood;
      }
      // where it looks: the pointer when it moved lately, else its own wandering
      let look = wander;
      if (now - ptr.at < POINTER_FRESH_MS) {
        ptr.look = pointerLook(ptr.cx, ptr.cy, el.getBoundingClientRect());
        look = { ...ptr.look, until: 0 };
      } else if (t > wander.until) {
        const w = wanderLook(Math.random(), Math.random());
        wander.x = w.x;
        wander.y = w.y;
        wander.until = t + 1.8 + Math.random() * 2.5;
      }
      const T = poseTarget(mood, look, t, m);
      // blinks: 0.2 s, never while resting
      if (mood !== "resting") {
        if (blinkT < 0 && t > nextBlink) blinkT = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          const b = blinkT / BLINK_SECONDS;
          if (b >= 1) {
            blinkT = -1;
            nextBlink = t + nextBlinkIn(Math.random(), Math.random());
          } else {
            const s = Math.sin(b * Math.PI);
            T.lid = Math.max(T.lid, s);
            T.lidLo = Math.max(T.lidLo, s);
          }
        }
      } else blinkT = -1;
      const k = 1 - Math.exp(-dt * 5);
      const kl = 1 - Math.exp(-dt * (T.lid > P.lid ? 40 : 12));
      P = {
        tilt: ease(P.tilt, T.tilt, k),
        dx: ease(P.dx, T.dx, k),
        dy: ease(P.dy, T.dy, k),
        bob: ease(P.bob, T.bob, k),
        breathe: ease(P.breathe, T.breathe, k),
        brF: ease(P.brF, T.brF, k),
        lean: ease(P.lean, T.lean, k),
        lid: ease(P.lid, T.lid, kl),
        lidLo: ease(P.lidLo, T.lidLo, kl),
      };
      if (mood === "answering") talk += dt * talkRate(t);
      beakNow = ease(beakNow, beakTarget(mood, talk, t), 1 - Math.exp(-dt * 28));
      const br = Math.sin(t * P.brF * 1.3) * P.breathe * m;
      const hop = mood === "answering" ? Math.abs(Math.sin(t * 4.2)) * P.bob * m : 0;
      const sway = Math.sin(t * 0.7) * 1.2 * m;
      if (rig.current) rig.current.style.transform = `translateY(${-hop * 100}%) scale(${1 + br * 0.5 + P.lean},${1 + br + P.lean})`;
      if (head.current) head.current.style.transform = `translate(${P.dx / 10.24}%,${P.dy / 10.24}%) rotate(${P.tilt + sway}deg)`;
      if (shadow.current) {
        shadow.current.style.transform = `scaleX(${1 - hop * 4})`;
        shadow.current.style.opacity = String(1 - hop * 6);
      }
      for (let i = 0; i < ups.length; i++) {
        ups[i].style.transform = `translateY(${-104 + 58 * P.lid}%)`;
        los[i].style.transform = `translateY(${104 - 56 * P.lidLo}%)`;
        shuts[i].style.opacity = String(Math.max(0, Math.min(1, (P.lid - 0.8) * 5)));
      }
      if (mouth.current) mouth.current.style.transform = `scaleY(${beakNow})`;
      if (beak.current) beak.current.style.transform = `translateY(${-beakNow * 0.35}%)`;
      // the wings: the angle the mood wants, a burst now and then, and (not with reduced motion) nothing sudden
      const wt = wingTargets(mood, t, talk, P.brF);
      if (!reducedRef.current && mood === "idle" && flutterT < 0 && t > flutterNext) flutterT = 0;
      let fl = 0;
      if (flutterT >= 0) {
        flutterT += dt;
        const fp = flutterT / FLUTTER_SECONDS;
        if (fp >= 1) {
          flutterT = -1;
          flutterNext = t + 5 + Math.random() * 5;
        } else fl = flutterAngle(fp, m);
      }
      const kw = 1 - Math.exp(-dt * 7);
      W.l = ease(W.l, wt.l, kw);
      W.r = ease(W.r, wt.r, kw);
      if (ctx && now - lastWing >= WING_FRAME_MS) {
        lastWing = now;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, g.width, g.height);
        drawWing(ctx, c.l, WING_LEFT, (W.l + fl) * m, scale, mesh);
        drawWing(ctx, c.r, WING_RIGHT, (W.r + fl) * m, scale, mesh);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      ro?.disconnect();
    };
  }, [running]);

  const fixed = size ? { width: size, height: size } : undefined;
  const stage = failed ? "still" : ready ? "live" : armed ? "loading" : "still";
  return (
    <div
      ref={root}
      className={`plush ${className}`}
      {...(fixed ? { style: fixed } : {})}
      data-plush={stage}
      data-mood={mood}
      data-motion={reduced ? "reduced" : "full"}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {/* from the server and with no script: this picture, and nothing else; it keeps the owl's name as its alt text (the box around it is the image a screen reader finds, so this one is hidden from it: no double reading) */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its size given; next/image would add a server round trip for nothing */}
      <img ref={still} src={OWL_FILES.still} width={STILL_PX} height={STILL_PX} alt={label ?? ""} aria-hidden={label ? true : undefined} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" draggable={false} className="plush-still" data-hidden={ready && !failed ? "true" : undefined} />
      {armed && !failed ? (
        <div className="plush-live" data-ready={ready ? "true" : undefined}>
          <div ref={shadow} className="plush-shadow" />
          <div ref={rig} className="plush-rig">
            <div ref={head} className="plush-head">
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img ref={(i) => void (layers.current.head = i)} src={OWL_FILES.head} width={LAYER_PX} height={LAYER_PX} alt="" loading="lazy" decoding="async" draggable={false} onLoad={checkReady} onError={() => setFailed(true)} />
              {EYES.map((_, i) => (
                <div key={i} className={`plush-lid plush-eye-${i}`}>
                  <i className="plush-lid-up" />
                  <i className="plush-lid-lo" />
                </div>
              ))}
              {EYES.map((_, i) => (
                <svg key={i} className={`plush-shut plush-eye-${i}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                  <path d={SHUT_ARC} fill="none" stroke="#6e5143" strokeWidth="5.5" strokeLinecap="round" />
                </svg>
              ))}
              <div ref={mouth} className="plush-mouth" />
              <div ref={beak} className="plush-beak">
                {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                <img ref={(i) => void (layers.current.beak = i)} src={OWL_FILES.beak} width={LAYER_PX} height={LAYER_PX} alt="" loading="lazy" decoding="async" draggable={false} onLoad={checkReady} onError={() => setFailed(true)} />
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img ref={(i) => void (layers.current.body = i)} src={OWL_FILES.body} width={LAYER_PX} height={LAYER_PX} alt="" loading="lazy" decoding="async" draggable={false} onLoad={checkReady} onError={() => setFailed(true)} />
            <canvas ref={canvas} width={LAYER_PX / 2} height={LAYER_PX / 2} className="plush-wings" />
          </div>
        </div>
      ) : null}
      <div className="plush-bubble" data-on={mood === "thinking" ? "true" : undefined} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="plush-zz" data-on={mood === "resting" ? "true" : undefined} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
