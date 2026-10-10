"use client";

/**
 * The 3D Agent OWL on its own small canvas (job AR). It imports three, so it is only ever loaded by AgentOwl3D through next/dynamic, never on the server and never in a first load.
 * Imperative on purpose (no react-three-fiber here: Today pays for three and this file, nothing more). The render loop runs only while the tab is visible AND the owl is on screen;
 * the pixel ratio is capped at 2; geometries, materials, textures, the renderer and the GL context are released on unmount. If the context cannot be created, or is lost, `onFail` is
 * called once and the parent draws the flat owl instead.
 */
import * as React from "react";
import * as THREE from "three";

import { OWL_PALETTE } from "./owl-colors";
import type { OwlMood } from "./owl-mood";
import { createOwl } from "./owl-model";

export type AgentOwlSceneProps = {
  mood: OwlMood;
  /** The first frame is on the canvas: the flat owl can step aside. */
  onReady: () => void;
  /** WebGL could not be created or was lost: show the flat owl. */
  onFail: () => void;
};

export default function AgentOwlScene({ mood, onReady, onFail }: AgentOwlSceneProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const moodRef = React.useRef(mood);
  const callbacks = React.useRef({ onReady, onFail });
  React.useEffect(() => {
    moodRef.current = mood;
    callbacks.current = { onReady, onFail };
  });

  React.useEffect(() => {
    const box = host.current;
    if (!box) return;
    // The canvas is made here, not by React: its WebGL context is lost for good when the renderer is released (cleanup), and React may run this effect again on the same element (strict mode).
    const el = document.createElement("canvas");
    el.className = "block size-full";
    box.appendChild(el);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
    } catch {
      el.remove();
      callbacks.current.onFail();
      return;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.9, 10.2);
    camera.lookAt(0, 1.75, 0);
    // the reference's light values, times PI (three r155 removed the old light scale the reference relied on)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a70, 0.9 * Math.PI));
    const key = new THREE.DirectionalLight(0xfff6ee, 1.35 * Math.PI);
    key.position.set(3, 6, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfeaff, 0.55 * Math.PI);
    fill.position.set(-5, 2, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7 * Math.PI);
    rim.position.set(0, 4, -6);
    scene.add(rim);

    const rig = createOwl(OWL_PALETTE.main, { detail: "high", extras: true, shadow: true });
    scene.add(rig.root);

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    ro?.observe(el);

    // desktop: the eyes follow the pointer anywhere on the page; touch devices only look around by themselves
    const hover = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      rig.setLook(((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)) * 1.4, -((e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)) * 1.4);
    };
    if (hover) window.addEventListener("pointermove", onPointer, { passive: true });

    let raf = 0;
    let onScreen = true;
    let last = performance.now();
    let clock = 0;
    let first = true;
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;
      rig.update(moodRef.current, clock, dt);
      renderer.render(scene, camera);
      if (first) {
        first = false;
        callbacks.current.onReady();
      }
      if (running()) raf = requestAnimationFrame(frame);
    };
    const running = () => onScreen && !document.hidden;
    const sync = () => {
      if (running() && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!running() && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    }, { threshold: 0.01 });
    io?.observe(el);
    document.addEventListener("visibilitychange", sync);
    const lost = (e: Event) => {
      e.preventDefault();
      callbacks.current.onFail();
    };
    el.addEventListener("webglcontextlost", lost);
    sync();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onPointer);
      io?.disconnect();
      ro?.disconnect();
      rig.dispose();
      for (const l of [key, fill, rim]) l.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    };
  }, []);

  return <div ref={host} className="size-full" />;
}
