import type { ReactNode } from "react";

/**
 * One row of a horizontal bar chart (design system v6): the label, a thin bar drawn as inline SVG in theme colours, and the number in words beside it. The bar is only a picture of the number (it is hidden from a screen reader); the words carry the value, so
 * the chart always has its text alternative. `width` is a whole number 0 to 100 (lib/reports-v6 `barWidths`). One hue, light on dark alike: the bar is `fill-brand-edge` on a `fill-surface-2` track.
 */
export function HBar({ label, width, value, sub = null }: { label: ReactNode; width: number; value: ReactNode; sub?: ReactNode }) {
  const w = Math.min(100, Math.max(0, Math.round(width)));
  return (
    <li data-bar={w} className="grid grid-cols-[minmax(5.5rem,9rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
      <span className="min-w-0 break-words text-base font-semibold">{label}</span>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="h-3 w-full">
        <rect x="0" y="0" width="100" height="10" rx="2" className="fill-surface-2" />
        {w > 0 ? <rect x="0" y="0" width={w} height="10" rx="2" className="fill-brand-edge" /> : null}
      </svg>
      <span className="min-w-12 text-right text-base font-semibold tabular-nums">{value}</span>
      {sub ? <span className="col-span-3 text-sm text-muted">{sub}</span> : null}
    </li>
  );
}
