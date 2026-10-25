import { Orb } from "@/components/v2/Orb";

import { orbStateOf } from "./orb-state";
import type { AiMood } from "./mood";

/**
 * The main assistant as a small picture beside a name (job DM): the AI circle, in the state the mood gives it. Used where no helper is named: empty states, lists of customers, the 404 page. It does NOT know the six helper icons (AgentMark does),
 * so a client file that imports it (the friendly error pages are in every route's script) does not carry them. `px` is the picture's width in CSS pixels, `off` fades it. Decorative.
 */
export function OrbMark({ px = 48, mood, off = false, className = "" }: { px?: number; mood?: AiMood; off?: boolean; className?: string }) {
  return <Orb px={Math.round(px * 0.72)} state={orbStateOf(mood)} className={`${off ? "opacity-45" : ""} ${className}`} />;
}
