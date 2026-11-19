/** A skeleton line or block instead of a spinner (Jobs design system): it pulses in opacity only, and stands still for a person who asked for less motion. `className` sets the size (for example "h-4 w-2/3"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" data-skeleton="" className={`jb-skeleton block ${className}`.trim()} />;
}
