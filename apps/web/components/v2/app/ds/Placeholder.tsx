/**
 * A quiet block that holds the room of a part of a screen that is still being read (Today and Leads draw their first screen without waiting for the slowest data). It is the size the part will have, so nothing jumps when the part arrives;
 * it pulses in opacity only, and stands still for a person who asked for less motion. `className` sets the size and the shape ("h-6 w-2/3", "min-h-40 rounded-xl").
 */
export function Placeholder({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" data-placeholder="" className={`block rounded-lg bg-surface-2 motion-safe:animate-pulse ${className}`.trim()} />;
}

/** The same block on a dark ground (the band of Today): a light veil instead of the page's own grey. */
export function PlaceholderOnDark({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" data-placeholder="" className={`block rounded-lg bg-white/10 motion-safe:animate-pulse ${className}`.trim()} />;
}

/** A card-shaped placeholder: the card's own border and ground, its height set by `className` (for example "min-h-[168px]"). */
export function CardPlaceholder({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" data-placeholder="" className={`rounded-xl border border-line bg-surface motion-safe:animate-pulse ${className}`.trim()} />;
}
