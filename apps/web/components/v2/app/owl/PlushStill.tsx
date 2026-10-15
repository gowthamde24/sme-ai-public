import type { OwlMood } from "./owl-mood";
import { STILL_PX, avatarWidths, owlAgent, stillFile, stillSrcSet } from "./owl-files";

/**
 * A plush owl as an avatar (jobs CI and CJ): the still picture only, for any of the seven agents (`agent`, default Agent OWL, sky blue) wherever an owl stands beside a name (cards, empty states, the team, the 404 page). A server
 * component with no script and no layers: the browser takes the 128 and 256 px files (1x and 2x of a small owl) or the 256 and 512 px ones (a bigger owl) by the size it is drawn at (`px` is the width in CSS pixels, `smPx` the width from 640 px up when it grows). Decorative (the name beside it is the label).
 * The still has one pose, so a mood is never drawn by it: where a screen needs to show one it says it in words or with a dot beside the owl (`StateDot`).
 */
export function PlushStill({ px, smPx, agent, mood, off = false, className = "" }: { px: number; smPx?: number; agent?: string; /** Only a hook for tests and styles (data-mood): the plush still has one pose. */ mood?: OwlMood; /** A helper that is switched off or not built yet: 45 % opacity. */ off?: boolean; className?: string }) {
  const sizes = smPx ? `(min-width: 640px) ${smPx}px, ${px}px` : `${px}px`;
  const a = owlAgent(agent);
  const widths = avatarWidths(Math.max(px, smPx ?? 0));
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file with its sizes given; next/image would add a server round trip for nothing
    <img src={stillFile(widths.find((w) => w >= Math.max(px, smPx ?? 0)) ?? widths[widths.length - 1], a)} srcSet={stillSrcSet(widths, a)} sizes={sizes} width={STILL_PX} height={STILL_PX} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} data-plush-avatar="true" data-agent={a} data-mood={mood} className={`shrink-0 select-none object-contain ${off ? "opacity-45" : ""} ${className}`} />
  );
}
