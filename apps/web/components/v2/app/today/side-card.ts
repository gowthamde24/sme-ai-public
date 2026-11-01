/**
 * The look of the four cards under the assistant row (store, done, new leads, team), two by two. They never leave a hole (owner, 1 Nov): when the last one is alone in its row (an odd number of cards: 3 or 1) it spans the full width and becomes ONE compact row,
 * title · line · link side by side. It is plain CSS on the card's place among its siblings, so a card that is not drawn (no permission, no Lead Desk) needs no counting; below `lg` the cards are one column anyway.
 * The class names are written out in full on purpose: the style scanner finds only names it can read as they are, never ones put together from pieces.
 */
export const SIDE_CARD =
  "group/side flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5 lg:[&:nth-child(odd):last-child]:col-span-2 lg:[&:nth-child(odd):last-child]:flex-row lg:[&:nth-child(odd):last-child]:items-center lg:[&:nth-child(odd):last-child]:gap-5 lg:[&:nth-child(odd):last-child]:py-3.5";
/** The title, the one line and the link of a card, which keep to one line when the card is a compact row. */
export const SIDE_TITLE = "font-display text-xl font-semibold lg:group-[:nth-child(odd):last-child]/side:shrink-0";
export const SIDE_LINE = "text-base text-muted [overflow-wrap:anywhere] lg:group-[:nth-child(odd):last-child]/side:min-w-0 lg:group-[:nth-child(odd):last-child]/side:flex-1 lg:group-[:nth-child(odd):last-child]/side:truncate";
export const SIDE_LINK = "inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline lg:group-[:nth-child(odd):last-child]/side:shrink-0 lg:group-[:nth-child(odd):last-child]/side:whitespace-nowrap";
