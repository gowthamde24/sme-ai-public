import type { OwlMood } from "./owl-mood";
import { STILL_PX, stillFile, stillSrcSet } from "./plush-rig";

/**
 * The plush owlet as an avatar (job CI follow-up): the still picture only, for the main agent where it is 56 to 112 px (empty states, the not-found page, the cards that say "nothing here yet"). A server component with no
 * script and no layers: the browser takes the 128 or the 256 px file by the size it is drawn at (`px` is the width in CSS pixels, `smPx` the width from 640 px up when it grows). Decorative like OwlSvg is (the name
 * beside it is the label). The six colour-coded helper owls stay the flat OwlSvg: their colour is how a person tells them apart, and the plush art has one colour.
 */
export function PlushStill({ px, smPx, mood, className = "" }: { px: number; smPx?: number; /** Only a hook for tests and styles (data-mood): the plush still has one pose. */ mood?: OwlMood; className?: string }) {
  const sizes = smPx ? `(min-width: 640px) ${smPx}px, ${px}px` : `${px}px`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its sizes given; next/image would add a server round trip for nothing
    <img src={stillFile(px >= 80 ? 256 : 128)} srcSet={stillSrcSet([128, 256])} sizes={sizes} width={STILL_PX} height={STILL_PX} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} data-plush-avatar="true" data-mood={mood} className={`shrink-0 select-none object-contain ${className}`} />
  );
}
