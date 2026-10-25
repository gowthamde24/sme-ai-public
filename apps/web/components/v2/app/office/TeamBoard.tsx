"use client";

import { AgentMark } from "../mark/AgentMark";
import { StateDot } from "../mark/StateDot";
import { ALL_AGENT_IDS, type AgentId, type Pose } from "./ids";
import { poseOf } from "./pose";

export { poseOf };

/**
 * The team board of the Office (job DM; it replaces the plush office with the owls around a table): the main assistant first, then the six helpers in the API's order, each a tile with its picture (the AI circle for the
 * main assistant, the icon of its job for a helper), its name and its state in words, and a dot for the state. A helper that is working has its circle moving (the main assistant) or a pulsing dot; one that is switched off or not built yet is
 * faded and still. Tapping a tile (a real button) chooses the helper, as the list's cards do. Plain DOM and CSS, no script of its own beyond the choice.
 */
export function TeamBoard({ poses, names, stateText, selected, onSelect, label, hint }: { poses: Record<AgentId, Pose>; names: Record<AgentId, string>; stateText: Record<AgentId, string>; selected: AgentId | null; onSelect: (id: AgentId | null) => void; label: string; hint: string }) {
  return (
    <div data-office="team">
      <ul role="group" aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ALL_AGENT_IDS.map((id) => {
          const on = selected === id;
          const pose = poses[id];
          return (
            <li key={id} data-agent={id} data-pose={pose} data-selected={on ? "true" : undefined} className={id === "main" ? "col-span-2 sm:col-span-4" : ""}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(on ? null : id)}
                className={`flex min-h-24 w-full items-center gap-3 rounded-2xl border p-4 text-left ${on ? "border-brand-edge bg-brand-bg" : "border-line bg-surface hover:bg-surface-2"}`}
              >
                <AgentMark agent={id === "main" ? undefined : id} px={id === "main" ? 64 : 48} mood={id === "main" && pose === "working" ? "thinking" : undefined} off={pose === "off"} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-base font-semibold [overflow-wrap:anywhere]">{names[id]}</span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <StateDot state={pose} />
                    <span>{stateText[id]}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-muted">{hint}</p>
    </div>
  );
}
