import type { AgentStatus, NeedsYouItem as ApiNeedsYouItem, RecentStep } from "@/lib/api/today";

/**
 * What the Today and Office screens draw. The shapes ARE lib/api's (`getToday()` and `getAgentsStatus()`, Job AD): the screens only add where "Open" goes (`href`, worked out from the
 * item's `target` by the page's data file). Money is in paise. A part that cannot be read is null and the screen says "Not available yet" in its place: nothing is guessed.
 */
export type { NeedsYouKind } from "@/lib/api/today";
export type NeedsYouItem = ApiNeedsYouItem & { href: string };
export type RecentItem = RecentStep & { href: string };
export type AgentRow = AgentStatus;
export type TodayCards = { waiting: number | null; money_held_paise: number | null; orders_open: number | null };
export type TodayData = { cards: TodayCards; needs_you: NeedsYouItem[] | null; recent: RecentItem[] | null; team: AgentRow[] | null };
export const NOTHING_TODAY: TodayData = { cards: { waiting: null, money_held_paise: null, orders_open: null }, needs_you: null, recent: null, team: null };
/** The words of the screen: the page resolves them in the person's language (server side) and passes this function. */
export type T = (key: string, vars?: Record<string, string | number>) => string;
