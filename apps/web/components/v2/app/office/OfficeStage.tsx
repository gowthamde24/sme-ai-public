"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import type { Detail } from "./scene/geo";
import { ALL_AGENT_IDS, type AgentId, type Pose } from "./scene/ids";
import { SceneLabels, type LabelPositions } from "./scene/SceneLabels";
import { useDark } from "./scene/use-dark";

// The only way three.js reaches the browser: a chunk of its own, requested when this component is first drawn (the person is shown the 3D view), never on the server.
const Office3D = dynamic(() => import("./scene/Office3D"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center">
      <div className="h-2/3 w-2/3 rounded-xl bg-surface-2 motion-safe:animate-pulse" />
    </div>
  ),
});

class SceneBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const LIGHT_BG = "radial-gradient(120% 90% at 50% 18%, #fff6ea 0%, #f6e4cf 58%, #eed7bd 100%)";
const DARK_BG = "radial-gradient(120% 90% at 50% 18%, #2d2433 0%, #1d1923 58%, #141118 100%)";

/**
 * The 3D room: the canvas, the name tags over it and the one line of help. It reports two ways of failing to its parent, which then shows the List with a sentence: `onFail("webgl")`
 * (the GPU keeps losing its context) and `onFail("error")` (the 3D code threw). It draws only what it is given: the pose of each helper (from the API's state), who is chosen, the words.
 */
export function OfficeStage({
  poses,
  names,
  stateText,
  selected,
  onSelect,
  reduced,
  coarse,
  phone,
  hint,
  loadingText,
  onFail,
}: {
  poses: Record<AgentId, Pose>;
  names: Record<AgentId, string>;
  stateText: Record<AgentId, string>;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  reduced: boolean;
  coarse: boolean;
  phone: boolean;
  hint: string;
  loadingText: string;
  onFail: (why: "webgl" | "error") => void;
}) {
  const dark = useDark();
  const [ready, setReady] = React.useState(false);
  const [canvasKey, setCanvasKey] = React.useState(0);
  const positions = React.useRef<LabelPositions>({});
  // Detail: full on a laptop, medium on touch devices, and one step less whenever the frame-rate monitor says the device cannot keep up.
  const [detail, setDetail] = React.useState<Detail>(coarse || phone ? "medium" : "high");
  const onDecline = React.useCallback(() => setDetail((d) => (d === "high" ? "medium" : "low")), []);
  const losses = React.useRef<number[]>([]);

  // A real context loss (GPU reset): rebuild the canvas; if it keeps happening, WebGL is unusable here.
  const onContextLost = React.useCallback(() => {
    const now = Date.now();
    losses.current = [...losses.current.filter((t) => now - t < 15000), now];
    setReady(false);
    if (losses.current.length >= 3) onFail("webgl");
    else setCanvasKey((k) => k + 1);
  }, [onFail]);

  // The name tags of the whole table need room; on a phone only the main agent and the chosen one have a tag.
  const stage = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pause rendering while the tab is hidden or the canvas is off-screen.
  const holder = React.useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = React.useState(true);
  const [tabVisible, setTabVisible] = React.useState(() => !document.hidden);
  React.useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  React.useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const state = React.useMemo(() => Object.fromEntries(ALL_AGENT_IDS.map((id) => [id, poses[id]])) as Record<AgentId, Pose>, [poses]);

  return (
    <div ref={holder} data-office-ready={String(ready)} data-detail={detail} className="relative isolate h-[54dvh] min-h-[23rem] overflow-hidden rounded-xl border border-line md:h-[34rem]" style={{ background: dark ? DARK_BG : LIGHT_BG }}>
      <div ref={stage} aria-hidden="true" className="absolute inset-0">
        <SceneBoundary onError={() => onFail("error")}>
          <Office3D
            key={canvasKey}
            dark={dark}
            reduced={reduced}
            coarse={coarse}
            phone={phone}
            active={onScreen && tabVisible}
            detail={detail}
            state={state}
            selected={selected}
            positions={positions}
            onSelect={onSelect}
            onReady={() => setReady(true)}
            onContextLost={onContextLost}
            onDecline={onDecline}
          />
        </SceneBoundary>
        <SceneLabels positions={positions} names={names} stateText={stateText} poses={poses} selected={selected} wide={wide} onSelect={(id) => onSelect(selected === id ? null : id)} />
      </div>
      <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-surface/90 px-3 py-2 text-sm text-muted">{ready ? hint : loadingText}</p>
    </div>
  );
}
