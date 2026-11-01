/**
 * The look of the four cards under the assistant row (store, done, new leads, team), two by two. They never leave a hole (owner, 1 Nov): when the last one is alone in its row (an odd number of cards: 3 or 1) it spans the full width and becomes ONE compact row,
 * title · line · link side by side. It is plain CSS on the card's place among its siblings, so a card that is not drawn (no permission, no Lead Desk) needs no counting; below `lg` the cards are one column anyway.
 */
const ALONE = "lg:[&:nth-child(odd):last-child]";
export const SIDE_CARD = `group/side flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5 ${ALONE}:col-span-2 ${ALONE}:flex-row ${ALONE}:items-center ${ALONE}:gap-5 ${ALONE}:py-3.5`;
/** The title, the one line and the link of a card, which keep to one line when the card is a compact row. */
const WHEN = "lg:group-[:nth-child(odd):last-child]/side";
export const SIDE_TITLE = `font-display text-xl font-semibold ${WHEN}:shrink-0`;
export const SIDE_LINE = `text-base text-muted [overflow-wrap:anywhere] ${WHEN}:min-w-0 ${WHEN}:flex-1 ${WHEN}:truncate`;
export const SIDE_LINK = `inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline ${WHEN}:shrink-0 ${WHEN}:whitespace-nowrap`;
