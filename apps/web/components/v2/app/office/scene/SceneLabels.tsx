"use client";

import * as React from "react";

import { ALL_AGENT_IDS, type AgentId, type Pose } from "./ids";

/** Where a tag starts: top left, and hidden until the first frame has placed it (an inline style, which the per-frame writes below can override). */
const START = { position: "absolute", left: 0, top: 0, visibility: "hidden", willChange: "transform" } as const;

export type LabelPositions = Partial<Record<AgentId, { x: number; y: number; on: boolean }>>;

/**
 * Name tags, drawn as ordinary DOM on top of the canvas (the 3D scene is aria-hidden: the list is the accessible version of the same facts). The scene writes each person's head
 * position (in pixels) into `positions` every frame; this overlay moves the tags with plain style writes, so nothing re-renders per frame. Each tag carries the helper's name and
 * the state the API gave (Idle, Working, Switched off, Not available yet), and a tag is a real button that selects the helper, as tapping the person does.
 * The tags of the whole table are drawn when there is room (`wide`); on a phone only the main agent and the chosen helper have one.
 */
export function SceneLabels({
  positions,
  names,
  stateText,
  poses,
  selected,
  wide,
  onSelect,
}: {
  positions: React.MutableRefObject<LabelPositions>;
  names: Record<AgentId, string>;
  stateText: Record<AgentId, string>;
  poses: Record<AgentId, Pose>;
  selected: AgentId | null;
  wide: boolean;
  onSelect: (id: AgentId) => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const els = React.useRef<Partial<Record<AgentId, HTMLElement | null>>>({});

  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const W = box.current?.clientWidth ?? 0;
      // The chosen helper's tag first, then the main agent's, then the others: a tag that would sit on one already placed is lifted above it, so no name is hidden.
      const order = [...ALL_AGENT_IDS].sort((a, b) => Number(b === selected) - Number(a === selected) || Number(b === "main") - Number(a === "main"));
      const placed: { l: number; r: number; t: number; b: number }[] = [];
      for (const id of order) {
        const el = els.current[id];
        const p = positions.current[id];
        if (!el || !p) continue;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const half = w / 2 + 6;
        const x = Math.min(Math.max(p.x, half), Math.max(half, W - half));
        let y = p.y;
        for (let guard = 0; guard < 8; guard++) {
          const hit = placed.find((r) => x - w / 2 < r.r && x + w / 2 > r.l && y - h < r.b && y > r.t);
          if (!hit) break;
          y = hit.t - 4;
        }
        if (p.on) placed.push({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        el.style.visibility = p.on ? "visible" : "hidden";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [positions, selected]);

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {ALL_AGENT_IDS.map((id) => {
        if (!(wide || id === "main" || selected === id)) return null;
        const hot = selected === id || id === "main";
        return (
          <div
            key={id}
            ref={(e) => {
              els.current[id] = e;
            }}
            style={START}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onSelect(id)}
              className={`pointer-events-auto flex w-max items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium shadow-[var(--v2-shadow)] ${hot ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink"} ${poses[id] === "off" ? "opacity-80" : ""}`}
            >
              <span>{names[id]}</span>
              <span className={`shrink-0 text-sm font-normal ${hot ? "opacity-90" : "text-muted"}`}>{`· ${stateText[id]}`}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
