import { AudioWaveform } from "lucide-react";

import type { OrbState } from "@/components/v2/Orb";

/**
 * The assistant's talk button as the owner's target draws it (1 Nov): a solid circle in the accent colour with a waveform on it, in light and dark, instead of the glass sphere. It keeps the `data-orb` word of the state (the ring around it, drawn by
 * the button that holds it, is what follows the voice). Idle it is calm; while it thinks or speaks the waveform pulses. Decorative: the button that holds it has the name. `px` is its width in CSS pixels; the size sits on its own wrapper (audit:leaks).
 */
export function TalkOrb({ px, state = "ambient" }: { px: number; state?: OrbState }) {
  return (
    <span style={{ display: "block", width: px, height: px, flex: "none" }} aria-hidden="true">
      <span data-orb={state} className="grid size-full place-items-center rounded-full bg-brand text-on-brand shadow-sm">
        <AudioWaveform className={`size-[46%] ${state === "think" || state === "speak" ? "motion-safe:animate-pulse" : ""}`} strokeWidth={2.2} />
      </span>
    </span>
  );
}
