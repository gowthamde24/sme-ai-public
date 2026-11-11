import type { SiteT } from "@/i18n/site";

/**
 * "Supported by" + the official "Cartesia Startups" lockup (Cartesia's brand page, https://www.cartesia.ai/brand). The two SVG files in
 * /public/brand are Cartesia's own, unchanged: black on light, white on dark. Their rules, kept here: never stretch (only the height is set,
 * the width follows the file's own proportions), never recolour or add an effect (no opacity, filter or shadow on the picture), never separate
 * the wordmark from the symbol (the lockup is one file), and the name is "Cartesia", never "Cartesia AI". Which file shows follows the
 * colour scheme in CSS (`.supported-by-*` in design/base.css), so there is no script. Server markup.
 */
const HREF = "https://cartesia.ai";
const FILE = { width: 311, height: 32 } as const; // the lockup's own size, so the space is held before it loads

export function SupportedBy({ t, className = "" }: { t: SiteT; className?: string }) {
  return (
    <p className={`my-0 flex items-center gap-2.5 text-[13px] text-muted ${className}`} data-part="supported-by">
      <span>{t("foot.supported")}</span>
      <a href={HREF} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- Cartesia's own SVG, committed to /public/brand, shown as it is (their rule: no resizing tricks) */}
        <img src="/brand/cartesia-startups-black.svg" alt="Cartesia" width={FILE.width} height={FILE.height} className="supported-by-light" />
        {/* eslint-disable-next-line @next/next/no-img-element -- the white file for dark backgrounds */}
        <img src="/brand/cartesia-startups-white.svg" alt="Cartesia" width={FILE.width} height={FILE.height} className="supported-by-dark" />
      </a>
    </p>
  );
}
