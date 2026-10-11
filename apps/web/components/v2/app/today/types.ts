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
export type OutboxCardMessage = { text: string; language: OutboxLanguage; category: OutboxCategory; flags: OutboxFlag[]; reasonText: string };
/** Why a call was asked for, as the card shows it. */
export type CallCardRequest = { reason: string };

/** One card of "Needs you". `key` is unique in the list; `at` is ISO 8601. */
export type NeedsCard =
  | { type: "item"; key: string; at: string; item: NeedsYouItem }
  | { type: "outbox"; key: string; at: string; id: string; customer: string | null; city: string | null; message: OutboxCardMessage | null }
  | { type: "call"; key: string; at: string; id: string; customer: string | null; city: string | null; request: CallCardRequest | null };

/**
 * The outbox log of the last 24 hours, boiled down (components/v2/app/today/digest.ts). `none` = the person may not read the log (a Viewer); `error` = it could not be read.
 * `lines` are the "Done while you slept" lines, at most four, biggest first; `sent` and `held` feed the Agent OWL's overnight line.
 */
export type DigestKind = OutboxCategory | "quiet";
export type DigestLine = { kind: DigestKind; n: number; /** "quiet" only: "9:00", the hour the messages go out. */ time?: string };
export type Digest = { state: "ready"; sent: number; held: number; lines: DigestLine[] } | { state: "none" } | { state: "error" };

/**
 * A visit to the shop today. Store visits are not in the API yet (job AS): the section is built behind this shape and is not drawn while `visits` is null or empty.
 * `starts_at` is ISO 8601 (the section shows it in the Indian day); `extra` is how many people come with the named one; `topic` is one short line ("Bridal sarees").
 */
export type StoreVisit = { id: string; starts_at: string; who: string; extra: number; topic: string | null; status: "confirmed" | "reminder_sent" | "requested" };

/** The role of the person on this workspace: the cards show only the actions it may take (the API checks again). */
export type Role = "owner" | "admin" | "sales" | "viewer";

export type TodayData = {
  cards: TodayCards;
  /** null = Today could not be read. */
  needs: NeedsCard[] | null;
  recent: RecentItem[] | null;
  team: AgentRow[] | null;
  /** null = no store-visit data (not built): the section is not drawn. */
  visits: StoreVisit[] | null;
  /** One promise for the last 24 hours of the outbox, never rejected: the overnight line and "Done while you slept" read it under a Suspense each. null = not asked. */
  digest: Promise<Digest> | null;
};
export const NOTHING_TODAY: TodayData = { cards: { waiting: null, money_held_paise: null, orders_open: null }, needs: null, recent: null, team: null, visits: null, digest: null };
/** The words of the screen: the page resolves them in the person's language (server side) and passes this function. */
export type T = (key: string, vars?: Record<string, string | number>) => string;
