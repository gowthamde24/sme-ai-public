"use client";

import type { CSSProperties } from "react";

import { PlushOwl } from "../owl/PlushOwl";
import { ALL_AGENT_IDS, type AgentId, type Pose } from "./ids";
import { drawOf } from "./pose";
import { SEATS } from "./seats";

/**
 * The plush office (job CJ, replacing the 3D room): the seven owls around a flat round table, Agent OWL at the head and the six helpers in the API's seat order, each a PlushOwl at a small size with its name and state under
 * it. Plain DOM and CSS (design/owl.css, `.office-*`); no WebGL, no three.js. A helper that is working sits at a glowing laptop (small bob, wings typing); an idle one breathes and blinks; one that is off (switched off or not
 * built yet) is a still picture at 45 % opacity. The animation runs only while an owl is on screen and the tab is visible (PlushOwl's own loop), and with reduced motion or a data saver every owl is a still picture (`lite`).
 * Tapping an owl or its tag chooses the helper (the same as the List's cards). On a 390 px phone the room is two rows (design/owl.css). The server draws the room too: from there, and with no script, the owls are their stills.
 */
export function PlushOffice({
  poses,
  names,
  stateText,
  selected,
  onSelect,
  lite,
  label,
  hint,
}: {
  poses: Record<AgentId, Pose>;
  names: Record<AgentId, string>;
  stateText: Record<AgentId, string>;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  lite: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="office-wrap" data-office="plush" data-lite={lite ? "true" : undefined}>
      <div className="office-room" role="group" aria-label={label}>
        <div className="office-table" aria-hidden="true" />
        {ALL_AGENT_IDS.map((id) => {
          const seat = SEATS[id];
          const draw = drawOf(poses[id], lite);
          const on = selected === id;
          return (
            // the numbers of the seat travel as custom properties on a wrapper that has no box (display: contents) and no class, so the seat itself stays a plain classed element (audit:leaks: style or classes, not both)
            <div key={id} style={{ display: "contents", "--x": `${seat.x}%`, "--y": `${seat.y}%`, "--pc": seat.phone.col, "--ps": seat.phone.span, "--pr": seat.phone.row } as CSSProperties}>
              <div className="office-seat" data-agent={id} data-pose={poses[id]} data-selected={on ? "true" : undefined}>
                {/* tapping the owl chooses the helper, as the tag below does (the tag is the button for the keyboard and a screen reader: the owl is a picture) */}
                <div className={`office-owl ${draw.faded ? "opacity-45" : ""}`} onClick={() => onSelect(on ? null : id)} aria-hidden="true">
                  <PlushOwl agent={id} mood={draw.mood} still={draw.still} working={draw.working} follow={false} sizes={id === "main" ? "140px" : "120px"} className="size-full" />
                  {draw.laptop ? <span className="office-laptop" data-office-laptop="" /> : null}
                </div>
                <button type="button" aria-pressed={on} onClick={() => onSelect(on ? null : id)} className="office-tag">
                  <span className="office-name">{names[id]}</span>{" "}
                  <span className="office-state">{stateText[id]}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted">{hint}</p>
    </div>
  );
}
