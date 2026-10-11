import type { OutboxCategory, OutboxFlag, OutboxLanguage } from "@/lib/api/outbox";
import type { AgentStatus, NeedsYouItem as ApiNeedsYouItem, RecentStep } from "@/lib/api/today";

/**
 * What the Today and Office screens draw. The shapes ARE lib/api's (`getToday()` and `getAgentsStatus()`, Job AD): the screens only add where "Open" goes (`href`, worked out from the
 * item's `target` by the page's data file). Money is in paise. A part that cannot be read is null and the screen says "Not available yet" in its place: nothing is guessed.
 */
export type { NeedsYouKind } from "@/lib/api/today";
/** The three kinds that are decided on another page: their card says what it is and "Open" goes to the page that decides. */
export type ClassicKind = "quote_approval" | "followup_due" | "order_money_held";
export type NeedsYouItem = Omit<ApiNeedsYouItem, "kind"> & { kind: ClassicKind; href: string };
export type RecentItem = RecentStep & { href: string };
export type AgentRow = AgentStatus;
export type TodayCards = { waiting: number | null; money_held_paise: number | null; orders_open: number | null };

/** The words of a WhatsApp message held for approval, as the card shows them. Only a person who may decide it is given them (the API sends them to the Owner and Admin only). */
export type OutboxCardMessage = { text: string; language: OutboxLanguage; category: OutboxCategory; flags: OutboxFlag[]; reasonText: string; /** An English gloss of the words (job BB), or null. */ gloss: string | null; /** The photos the message carries (a catalogue send), in order. */ media: { position: number; thumb_url: string | null }[] };
/** Why a call was asked for, as the card shows it, and the language the customer is spoken to in (the visit offer goes out in it). */
export type CallCardRequest = { reason: string; language: OutboxLanguage };
/** A visit Agent OWL proposed (booked, not confirmed): the card asks the person to confirm it, move it or cancel it. `startsAt` is ISO 8601. */
export type ProposedVisit = { who: string; customer: string | null; city: string | null; startsAt: string; partySize: number; purpose: string | null };

/** One card of "Needs you". `key` is unique in the list; `at` is ISO 8601. */
export type NeedsCard =
  | { type: "item"; key: string; at: string; item: NeedsYouItem }
  | { type: "outbox"; key: string; at: string; id: string; customer: string | null; city: string | null; message: OutboxCardMessage | null }
  | { type: "call"; key: string; at: string; id: string; customer: string | null; city: string | null; request: CallCardRequest | null }
  | { type: "visit"; key: string; at: string; id: string; visit: ProposedVisit };

/**
 * The outbox log of the last 24 hours, boiled down (components/v2/app/today/digest.ts). `none` = the person may not read the log (a Viewer); `error` = it could not be read.
 * `lines` are the "Done while you slept" lines, at most four, biggest first; `sent` and `held` feed the Agent OWL's overnight line.
 */
export type DigestKind = OutboxCategory | "quiet";
export type DigestLine = { kind: DigestKind; n: number; /** "quiet" only: "9:00", the hour the messages go out. */ time?: string };
export type Digest = { state: "ready"; sent: number; held: number; lines: DigestLine[] } | { state: "none" } | { state: "error" };

/**
 * A visit to the shop today, as "At the store today" draws it (`GET /visits/today`). `starts_at` is ISO 8601 (the section shows it in the Indian day); `extra` is how many people come with the named
 * one; `topic` is one short line ("Bridal sarees"); `here` = the customer has arrived.
 */
export type StoreVisit = { id: string; starts_at: string; who: string; extra: number; topic: string | null; status: "confirmed" | "reminder_sent" | "requested"; here: boolean };
/**
 * The store today: the visits still to come or here now, and the state of the rest of the day from the slots: `free` (with `nextFree`, the first free time still to come, ISO), `full` (every time left is taken),
 * `closed` (the shop is closed today) or `unknown` (the slots could not be read: the line is not drawn).
 */
export type StoreToday = { visits: StoreVisit[]; slots: "free" | "full" | "closed" | "unknown"; nextFree: string | null };

/** The role of the person on this workspace: the cards show only the actions it may take (the API checks again). */
export type Role = "owner" | "admin" | "sales" | "viewer";

export type TodayData = {
  cards: TodayCards;
  /** null = Today could not be read. */
  needs: NeedsCard[] | null;
  recent: RecentItem[] | null;
  team: AgentRow[] | null;
  /** The store today. null = not asked (the section is not drawn); `error` = it could not be read (the section says so). */
  store: ({ state: "ready" } & StoreToday) | { state: "error" } | null;
  /** The share of this week's AI allowance used (0 to 100), for the usage card. Owner and Admin only: null = not asked; `error` = could not be read. */
  week: { percent: number } | "error" | null;
  /** Whether sending is stopped for the whole system (the operator's kill switch). Owner and Admin only: null = not asked, or could not be read (no banner is drawn for what is not known). */
  sending: { stopped: boolean } | null;
  /** One promise for the last 24 hours of the outbox, never rejected: the overnight line and "Done while you slept" read it under a Suspense each. null = not asked. */
  digest: Promise<Digest> | null;
};
export const NOTHING_TODAY: TodayData = { cards: { waiting: null, money_held_paise: null, orders_open: null }, needs: null, recent: null, team: null, store: null, week: null, sending: null, digest: null };
/** The words of the screen: the page resolves them in the person's language (server side) and passes this function. */
export type T = (key: string, vars?: Record<string, string | number>) => string;
