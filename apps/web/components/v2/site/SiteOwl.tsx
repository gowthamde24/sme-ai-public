import { STILL_PX, owlAgent, stillFile, stillSrcSet } from "@/components/v2/app/owl/plush-rig";

/**
 * A plush owl picture for the public site (job CM): the still webp in 128 and 256 px with `srcset` and `sizes`, so a phone takes the 128 or 256 px file (10 to 17 KB) and never the 512 px one. `priority` is for the one
 * picture above the fold: it is fetched at once (`fetchpriority="high"`, not lazy); every other owl waits until it is near the screen. Decorative: the words beside it say what it is. A server component with no script.
 */
export function SiteOwl({ agent, px, smPx, priority = false, className = "" }: { agent?: string; /** CSS width on a phone. */ px: number; /** CSS width from 640 px up, when it grows. */ smPx?: number; priority?: boolean; className?: string }) {
  const a = owlAgent(agent);
  const sizes = smPx ? `(min-width: 640px) ${smPx}px, ${px}px` : `${px}px`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its sizes given; next/image would add a server round trip for nothing
    <img
      src={stillFile(Math.max(px, smPx ?? 0) >= 80 ? 256 : 128, a)}
      srcSet={stillSrcSet([128, 256], a)}
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
