import { BRAND_NAME } from "@/design/brand";

/**
 * The footer's wordmark: the three bars and the brand name as dots (the page's own dot look), drawn in CSS (design/footer-mark.css) from the server: a still picture, no canvas and no script (owner, 21 Nov 2026: only the phone demo and the
 * Lead Finder's sweep move on this page). One image to a screen reader (its name).
 */
export function BrandMark({ label }: { label: string }) {
  return (
    <div className="h3-wm-box relative mx-auto mt-[clamp(12px,3vw,40px)] aspect-[1240/266] w-full max-w-[1240px]" role="img" aria-label={label} data-part="brand-dots">
      <div className="h3-wm" aria-hidden="true" data-illustration="">
        <span className="h3-wm-bar h3-wm-b1" />
        <span className="h3-wm-bar h3-wm-b2" />
        <span className="h3-wm-bar h3-wm-b3" />
        <span className="h3-wm-t" data-name={BRAND_NAME} />
      </div>
    </div>
  );
}
