/**
 * What the Today screen draws. The shapes mirror `getToday()` and `getAgentsStatus()` of lib/api (Job AC contract, Claude 1). Money is in paise. A field that cannot be
 * read yet is null and the screen says "Not available yet" in its place: nothing is guessed. The `href` of an item is where "Open" goes (the contract's item carries
 * only an id; see the report: the item needs the id of the enquiry, lead or order it belongs to).
 */
export type NeedsYouKind = "quote_approval" | "followup_due" | "order_money_held";
export type NeedsYouItem = { kind: NeedsYouKind; id: string; customer: string; city: string | null; agent: string; summary: string; at: string; amount_paise: number | null; href: string };
export type RecentItem = { kind: string; order_ref: string; customer: string; text: string; at: string; href: string | null };
export type AgentRow = { agent: string; state: "idle" | "working" | "not_available"; job: string | null; last_event: string | null };
export type TodayCards = { waiting: number | null; money_held_paise: number | null; orders_open: number | null };
export type TodayData = { cards: TodayCards; needs_you: NeedsYouItem[] | null; recent: RecentItem[] | null; team: AgentRow[] | null };
export const NOTHING_TODAY: TodayData = { cards: { waiting: null, money_held_paise: null, orders_open: null }, needs_you: null, recent: null, team: null };
/** The words of the screen: the page resolves them in the person's language (server side) and passes this function. */
export type T = (key: string, vars?: Record<string, string | number>) => string;
