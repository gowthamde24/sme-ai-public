/**
 * The logo: three rounded bars, the first and last in the brand colour and the middle in ink (the "Layers" mark of the brand folder, public/icons/mark.svg is the same drawing for the icons and the share pictures). Drawn inline so it takes the
 * theme's colours (the ink turns light in the dark theme). `px` is its width in CSS pixels. Decorative: the name beside it says what it is. A server component with no script.
 */
export function Mark({ px = 28, className = "" }: { px?: number; className?: string }) {
  return (
    <svg width={px} height={px} viewBox="0 0 96 96" aria-hidden="true" data-mark="" className={`shrink-0 ${className}`}>
      <rect x="14" y="14" width="46" height="18" rx="9" className="fill-brand-text" />
      <rect x="14" y="39" width="68" height="18" rx="9" className="fill-ink" />
      <rect x="36" y="64" width="46" height="18" rx="9" fillOpacity="0.55" className="fill-brand-text" />
    </svg>
  );
}
