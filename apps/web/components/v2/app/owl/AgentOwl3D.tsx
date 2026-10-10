"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import { webglAvailable } from "../office/scene/webgl";
import { OwlSvg } from "./OwlSvg";
import type { OwlMood } from "./owl-mood";
import { owlRender, type OwlEnv, type OwlRender } from "./owl-mode";

// The only way three.js reaches Today: a chunk of its own, requested after the first paint and never on the server. The flat owl is on screen until the first 3D frame is drawn.
const AgentOwlScene = dynamic(() => import("./AgentOwlScene"), { ssr: false });

const noSubscribe = () => () => {};
type Nav = Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
let env: OwlEnv | null = null;
function readEnv(): OwlEnv {
  if (env) return env;
  const nav = navigator as Nav;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  env = { reducedMotion: reduced, cores: navigator.hardwareConcurrency || undefined, webgl: webglAvailable(), saveData: nav.connection?.saveData, effectiveType: nav.connection?.effectiveType, deviceMemory: nav.deviceMemory };
  return env;
}

/** The 3D chunk is requested only when the page is idle (requestIdleCallback; a short timer where the browser has none), so it never competes with the first paint or the page's own work. */
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

/**
 * Agent OWL on the Today screen: the 3D owl, drawn on a small canvas, in the mood the Ask box gives it. About 160 px on a laptop and 120 px on a phone, in a box of that size from the first
 * paint (the flat owl stands in while the 3D chunk loads, so nothing moves). It stays the flat owl when WebGL is missing, the device has two cores or fewer, or the WebGL context cannot be
 * created or is lost, the data saver is on, the connection is 3G or slower, or the device has 2 GB of memory or less (three.js is then never downloaded); with reduced motion it is the flat owl
 * standing still in its pose. The 3D chunk is requested only once the page is idle (requestIdleCallback, a short timer where there is none). It is an image with a name and the mood, and the mood is also text for a screen reader.
 */
export function AgentOwl3D({ mood, name, moodText, className = "", env: given }: { mood: OwlMood; name: string; moodText: string; className?: string; /** What the browser can do, when the caller already knows (tests); read from the browser when omitted. */ env?: OwlEnv }) {
  const detected = React.useSyncExternalStore(noSubscribe, () => owlRender(given ?? readEnv()), (): OwlRender => "svg");
  const [failed, setFailed] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [idle, setIdle] = React.useState(false);
  const render: OwlRender = failed ? "svg" : detected;
  const onReady = React.useCallback(() => setReady(true), []);
  const onFail = React.useCallback(() => setFailed(true), []);
  const show3d = render === "3d";
  React.useEffect(() => {
    if (!show3d || idle) return;
    return whenIdle(() => setIdle(true));
  }, [show3d, idle]);
  return (
    <>
      <div role="img" aria-label={`${name}, ${moodText}`} data-owl-render={show3d && ready ? "3d" : render === "svg-still" ? "svg-still" : "svg"} className={`relative size-[120px] shrink-0 sm:size-40 ${className}`}>
        <OwlSvg agent="main" mood={mood} still={render === "svg-still"} className={`absolute inset-0 size-full ${show3d && ready ? "invisible" : ""}`} />
        {show3d && idle ? (
          <div className="absolute inset-0">
            <AgentOwlScene mood={mood} onReady={onReady} onFail={onFail} />
          </div>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {moodText}
      </span>
    </>
  );
}
