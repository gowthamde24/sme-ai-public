import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import type { AnalyserHolder } from "@/components/v2/orb-types";

/** What the circle is doing: nothing (`still`: lists, empty states), calm (`ambient`), following the microphone (`listen`), thinking (faster) or speaking (it follows the voice). */
export type OrbState = "still" | "ambient" | "listen" | "think" | "speak";

/**
 * the assistant's circle (job DM, redrawn night 5 as the glass sphere with flowing ribbons: components/v2/AssistantOrb.tsx). This is the place every screen puts it: it keeps the size wrapper, the `data-orb` word of the state and the halo, and the canvas
 * arrives as a lazy chunk on top of a dark sphere that is already drawn by CSS (design/orb.css), so nothing jumps. `px` is its size in CSS pixels. `analyser` (Web Audio) makes the ribbons follow the microphone or the voice. It is decorative: the
 * name beside it says what it is. With "reduce motion", and for `still`, it is one frame. The size sits on its own wrapper because v2 code never puts a `style` and a `className` on one element (audit:leaks); `className` is for where it stands.
 */
export function Orb({ px, state = "ambient", halo = false, className = "", analyser = null }: { px: number; state?: OrbState; halo?: boolean; className?: string } & AnalyserHolder) {
  const sphere = (
    <span style={{ display: "block", width: px, height: px, flex: "none" }}>
      <span className="orb" data-orb={state} aria-hidden="true">
        <AssistantOrb state={state} still={state === "still"} analyser={analyser} />
      </span>
    </span>
  );
  return (
    <span className={`${halo ? "orb-halo" : "inline-flex shrink-0 items-center justify-center"} ${className}`} aria-hidden="true">
      {sphere}
    </span>
  );
}
