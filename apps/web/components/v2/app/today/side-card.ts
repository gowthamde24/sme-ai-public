/**
 * The look of the summary cards under the assistant row (sidebar v2, owner 5 Nov: new leads, at the store today, done while you slept, money held, side by side). Four in a row on a wide screen (as many as there are: the row fills itself,
 * so a card that is not drawn leaves no hole), two by two below that (a last card alone in its row spans both), one column on a phone. The class names are written out in full on purpose: the style scanner finds only names it can read.
 */
export const SIDE_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]";
export const SIDE_CARD = "flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5 sm:[&:nth-child(odd):last-child]:col-span-2 xl:[&:nth-child(odd):last-child]:col-span-1";
/** The title, the line and the link of a card (the link sits at the foot, so the cards of a row line up). */
export const SIDE_TITLE = "font-display text-xl font-semibold";
export const SIDE_LINE = "text-base text-muted [overflow-wrap:anywhere]";
export const SIDE_LINK = "mt-auto inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline";
