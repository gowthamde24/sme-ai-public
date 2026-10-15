import { STILL_PX, avatarWidths, owlAgent, stillFile, stillSrcSet, type StillWidth } from "@/components/v2/app/owl/owl-files";

/**
 * A plush owl picture for the public site (job CM): the still webp with `srcset` and `sizes` (1x and 2x of the size it is drawn at, never a smaller file stretched), so a small owl takes the 128 or 256 px file (6 to 14 KB). `priority` is for the one
 * picture above the fold: it is fetched at once (`fetchpriority="high"`, not lazy); every other owl waits until it is near the screen. Decorative: the words beside it say what it is. A server component with no script.
 */
export function SiteOwl({ agent, px, smPx, priority = false, widths, className = "" }: { agent?: string; /** CSS width on a phone. */ px: number; /** CSS width from 640 px up, when it grows. */ smPx?: number; priority?: boolean; /** The files offered in `srcset` (the default is the 1x and 2x files of its size; the hero offers 512 and 1024, so a sharp screen gets the 1024 px owl and a 1x phone the 512 px one). */ widths?: readonly StillWidth[]; className?: string }) {
  const a = owlAgent(agent);
  const sizes = smPx ? `(min-width: 640px) ${smPx}px, ${px}px` : `${px}px`;
  const files = widths ?? avatarWidths(Math.max(px, smPx ?? 0));
  const first = files.find((w) => w >= Math.max(px, smPx ?? 0)) ?? files[files.length - 1];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its sizes given; next/image would add a server round trip for nothing
    <img
      src={stillFile(first, a)}
      srcSet={stillSrcSet(files, a)}
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
