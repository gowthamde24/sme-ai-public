import { BRAND_NAME } from "@/design/brand";

/** The Layers mark: three stacked rounded bars (the middle one in ink, the outer two in the brand colour). Decorative: the name beside it carries the meaning. */
export function LayersMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <rect x="14" y="14" width="46" height="18" rx="9" className="fill-brand" />
      <rect x="14" y="39" width="68" height="18" rx="9" className="fill-ink" />
      <rect x="36" y="64" width="46" height="18" rx="9" className="fill-brand" fillOpacity="0.55" />
    </svg>
  );
}

/** The wordmark: the Layers mark and the name from the one brand constant. Takes no name prop on purpose. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 leading-tight">
      <LayersMark />
      <span className="font-display text-2xl font-extrabold tracking-tight">{BRAND_NAME}</span>
    </span>
  );
}
