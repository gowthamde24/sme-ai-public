/**
 * The suggestion chips of each screen (job DQ part 0): the same few questions the assistant always answers (what needs me today, who to call first, how much customer money is held, which quotes wait, what the team did), in the
 * order that fits the screen the person is on. Pure: the keys are words of the string store, resolved by the caller in the person's language (and for the business type: `ask.chip.quotes@programmes`). Nothing here names a business type.
 */
export type ChipKey = "ask.chip.needs" | "ask.chip.call" | "ask.chip.money" | "ask.chip.quotes" | "ask.chip.team";

const SCREENS: Readonly<Record<string, readonly ChipKey[]>> = {
  // customers: leads, customers, find retailers, students, sites
  review: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  leads: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  companies: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  contacts: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  customers: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  retailers: ["ask.chip.call", "ask.chip.needs", "ask.chip.team"],
  students: ["ask.chip.call", "ask.chip.needs", "ask.chip.money"],
  sites: ["ask.chip.needs", "ask.chip.call", "ask.chip.money"],
  // chats: customer chats, outbox, announcements
  chats: ["ask.chip.needs", "ask.chip.call", "ask.chip.team"],
  outbox: ["ask.chip.needs", "ask.chip.team", "ask.chip.call"],
  announcements: ["ask.chip.needs", "ask.chip.team", "ask.chip.call"],
  // calls: follow-ups, the call list, campaigns
  followups: ["ask.chip.call", "ask.chip.needs", "ask.chip.team"],
  "call-list": ["ask.chip.call", "ask.chip.money", "ask.chip.needs"],
  campaigns: ["ask.chip.call", "ask.chip.team", "ask.chip.needs"],
  // sales: quotes, orders, store visits, fees and admissions, dues
  quotes: ["ask.chip.quotes", "ask.chip.money", "ask.chip.needs"],
  enquiries: ["ask.chip.quotes", "ask.chip.call", "ask.chip.needs"],
  orders: ["ask.chip.money", "ask.chip.quotes", "ask.chip.needs"],
  visits: ["ask.chip.needs", "ask.chip.quotes", "ask.chip.call"],
  fees: ["ask.chip.money", "ask.chip.call", "ask.chip.needs"],
  admissions: ["ask.chip.quotes", "ask.chip.call", "ask.chip.needs"],
  dues: ["ask.chip.money", "ask.chip.call", "ask.chip.needs"],
  // catalogue and prices, reports
  catalogue: ["ask.chip.needs", "ask.chip.money"],
  materials: ["ask.chip.needs", "ask.chip.money"],
  "item-types": ["ask.chip.quotes", "ask.chip.needs"],
  "price-list": ["ask.chip.quotes", "ask.chip.needs"],
  programmes: ["ask.chip.needs", "ask.chip.quotes"],
  report: ["ask.chip.money", "ask.chip.needs", "ask.chip.team"],
};
const FALLBACK: readonly ChipKey[] = ["ask.chip.needs", "ask.chip.call", "ask.chip.money"];

/** The chips of Today's card: the three questions that must always work. */
export const TODAY_CHIPS: readonly ChipKey[] = ["ask.chip.needs", "ask.chip.call", "ask.chip.money"];

/** The chips for a path under the workspace (`/leads`, `/quotes/…`): by its first segment; the three common ones where the screen has none of its own. The workspace home with a records tab (`?tab=leads`, `?tab=companies`) is the Customers screen. */
export function chipsForPath(rest: string, tab: string | null = null): readonly ChipKey[] {
  const first = rest.split("/").filter(Boolean)[0] ?? "";
  if (first === "" && tab) return SCREENS.customers;
  return SCREENS[first] ?? FALLBACK;
}

/** Today (the home with no records tab): on a desktop its command bar is the assistant, on a phone the floating orb is. `rest` is the path under the workspace ("" = the home) and `tab` its `?tab=`. */
export const isTodayHome = (rest: string, tab: string | null = null): boolean => (rest === "" || rest === "/") && !tab;

/** Where the floating orb is not drawn on a desktop: Today (its command bar is the assistant) and the live call. On a phone the orb is on every screen, Today included. */
export function orbHidden(rest: string, tab: string | null = null): boolean {
  if (rest === "" || rest === "/") return !tab;
  return rest === "/office/live" || rest.startsWith("/office/live/");
}
