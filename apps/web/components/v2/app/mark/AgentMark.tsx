import { ClipboardList, FileSearch, FileText, PackageCheck, RefreshCw, Search, type LucideIcon } from "lucide-react";

import type { AiMood } from "./mood";
import { OrbMark } from "./OrbMark";
import { orbStateOf } from "./orb-state";

/** The six helpers by the job they do, each with its own icon (the API's agent keys; a test keeps the list equal to lib/api/today.ts AGENT_KEYS). The main assistant has no icon: it is the AI circle. */
export const HELPER_ICONS: Record<string, LucideIcon> = {
  lead_finder: Search,
  researcher: FileSearch,
  requirement_analyst: ClipboardList,
  quote_writer: FileText,
  followup_desk: RefreshCw,
  order_desk: PackageCheck,
};

/** The six helpers in the order of the six steps (Find leads, Research, Understand, Quote, Follow up, Close and collect); the main assistant leads them and is not a step. */
export const HELPER_AGENTS = ["lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"] as const;
export type HelperAgent = (typeof HELPER_AGENTS)[number];

export { orbStateOf };

/**
 * Who is speaking, as a small picture beside a name (job DM, replacing the owl pictures): the main assistant is the AI circle; each of the six helpers is the icon of its job on a soft tile (the same shape, so a list of them reads as one team).
 * `px` is the width in CSS pixels. `mood` moves the circle (see orbStateOf); `off` is a helper that is switched off or not built yet (45 % opacity). Decorative: the name beside it is the label. A server component with no script.
 */
export function AgentMark({ agent, px = 48, mood, off = false, className = "" }: { agent?: string; px?: number; mood?: AiMood; off?: boolean; className?: string }) {
  const Icon = agent ? HELPER_ICONS[agent] : undefined;
  const dim = off ? "opacity-45" : "";
  if (!Icon) return <OrbMark px={px} mood={mood} off={off} className={className} />;
  const icon = Math.round(px * 0.5);
  return (
    <span data-agent-mark={agent} aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-2xl bg-brand-bg text-brand-text ${dim} ${className}`}>
      <span style={{ display: "flex", width: px, height: px, alignItems: "center", justifyContent: "center" }}>
        <Icon width={icon} height={icon} strokeWidth={1.9} aria-hidden="true" />
      </span>
    </span>
  );
}
