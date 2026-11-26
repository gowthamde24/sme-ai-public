/** The side menu's box: sticky, as tall as the window, from 768px up (the phone has the bottom bar instead). */
export const frameBand = "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex";

/**
 * An icon button of the top bar (owner-approved boxy mock, 26 Nov 2026): no border at rest, a soft grey round hover, a round focus ring, a 44px target. It is written as `min-h-[44px] min-w-[44px]` (not `size-11`) on purpose: the
 * density rules of ds.css shrink every `size-11` / `min-h-11` button of the bar to 32 or 40px, and the phone and the desktop would then show different sizes.
 */
export const topIconButton = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-0 bg-transparent text-ink transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line focus-visible:rounded-full! aria-expanded:bg-surface-2";
/** The language pill of the top bar: the same quiet look as the icon buttons (no border at rest, a soft round hover); its text and globe are drawn by LangSelect. */
export const quietSelect = "inline-flex min-h-[44px] items-center rounded-full border-0 bg-transparent text-ink transition-colors duration-150 ease-out hover:bg-surface-2 focus-visible:rounded-full!";
