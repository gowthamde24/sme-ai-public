import { STILL_PX, STILL_WIDTHS, owlAgent, stillFile, stillSrcSet } from "@/components/v2/app/owl/plush-rig";

/**
 * A plush owl picture for the public site (job CM): the still webp in 128 and 256 px with `srcset` and `sizes`, so a phone takes the 128 or 256 px file (10 to 17 KB) and never the 512 px one. `priority` is for the one
 * picture above the fold: it is fetched at once (`fetchpriority="high"`, not lazy); every other owl waits until it is near the screen. Decorative: the words beside it say what it is. A server component with no script.
 */
export function SiteOwl({ agent, px, smPx, priority = false, widths = [128, 256], className = "" }: { agent?: string; /** CSS width on a phone. */ px: number; /** CSS width from 640 px up, when it grows. */ smPx?: number; priority?: boolean; /** The files offered in `srcset` (the biggest picture on the page offers 256 and 512, so a sharp screen gets a sharp owl and a phone still takes the 256 px one). */ widths?: readonly (typeof STILL_WIDTHS)[number][]; className?: string }) {
  const a = owlAgent(agent);
  const sizes = smPx ? `(min-width: 640px) ${smPx}px, ${px}px` : `${px}px`;
  const first = widths.find((w) => w >= Math.max(px, smPx ?? 0)) ?? widths[widths.length - 1];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its sizes given; next/image would add a server round trip for nothing
    <img
      src={stillFile(first, a)}
      srcSet={stillSrcSet(widths, a)}
      sizes={sizes}
      width={STILL_PX}
      height={STILL_PX}
      alt=""
      aria-hidden="true"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      draggable={false}
      data-site-owl={a}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}
