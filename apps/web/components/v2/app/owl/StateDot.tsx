/**
 * The mood signal next to a plush still (job CJ): the still has one pose, so a state that the flat owl used to act out (working, calm, switched off) is a small dot beside it. Always decorative: the words beside the
 * dot (the status line, the tag) are what a screen reader gets. Working pulses (not with reduced motion); idle is solid; off is an empty ring.
 */
export type DotState = "working" | "idle" | "off";
export function StateDot({ state, className = "" }: { state: DotState; className?: string }) {
  const look = state === "working" ? "bg-brand motion-safe:animate-pulse" : state === "idle" ? "bg-muted" : "border-2 border-muted bg-transparent";
  return <span aria-hidden="true" data-state-dot={state} className={`inline-block size-2.5 shrink-0 rounded-full ${look} ${className}`} />;
}
