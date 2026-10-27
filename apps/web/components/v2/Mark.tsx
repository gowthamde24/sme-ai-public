/**
 * The logo: three rounded bars, the first and last in the brand colour and the middle in ink (the "Layers" mark of the brand folder, public/icons/mark.svg is the same drawing for the icons and the share pictures). Drawn inline so it takes the
 * theme's colours (the ink turns light in the dark theme). `px` is its width in CSS pixels. Decorative: the name beside it says what it is. A server component with no script.
 */
export function Mark({ px = 28, className = "" }: { px?: number; className?: string }) {
  return (
    <svg width={px} height={px} viewBox="0 0 96 96" aria-hidden="true" data-mark="" strokeWidth="18" strokeLinecap="round" className={`shrink-0 ${className}`}>
      <path d="M23 23h28" className="stroke-brand-text" />
      <path d="M23 48h50" className="stroke-ink" />
      <path d="M45 73h28" className="stroke-brand-text/55" />
    </svg>
  );
}
