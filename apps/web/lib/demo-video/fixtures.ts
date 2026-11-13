import type { Thread, ThreadItem } from "@/lib/api/whatsapp";
import type { PracticeCall, Prospect, QuoteDraftMade, QuoteDraftView, Search } from "@/lib/lead-finder/types";
import type { AgentRow, Digest, NeedsCard, TodayData } from "@/components/v2/app/today/types";

/**
 * The invented data of the demo video (job demo-video): one saree wholesaler in Vijayawada on a good morning. Nobody here is a real person or a real business; no phone number is shown. The screens of the story draw these through
 * the REAL components (Today, Needs you, the WhatsApp chat, the Lead Finder's cards, the practice call, the draft quote), in the browser only: nothing is read from the API for them and nothing is sent or saved.
 * Times are relative to `now` (the moment the page was drawn), so "2 min ago" reads right on any day.
 */
export const BUSINESS = { name: "Sri Venkateswara Silks", owner: "Ravi", letters: "RK" } as const;

const MIN = 60_000;
const at = (now: number, minutesAgo: number): string => new Date(now - minutesAgo * MIN).toISOString();

export const IDS = {
  quote: "d0d0d0d0-0001-4000-8000-000000000001",
  followup: "d0d0d0d0-0001-4000-8000-000000000002",
  message: "d0d0d0d0-0001-4000-8000-000000000003",
  newQuote: "d0d0d0d0-0001-4000-8000-000000000004",
  lead: "d0d0d0d0-0002-4000-8000-000000000001",
  prospectLead: "d0d0d0d0-0002-4000-8000-000000000002",
  enquiry: "d0d0d0d0-0003-4000-8000-000000000001",
  search: "d0d0d0d0-0004-4000-8000-000000000001",
  call: "d0d0d0d0-0005-4000-8000-000000000001",
  visit: "d0d0d0d0-0006-4000-8000-000000000001",
  prospects: ["d0d0d0d0-0007-4000-8000-000000000001", "d0d0d0d0-0007-4000-8000-000000000002", "d0d0d0d0-0007-4000-8000-000000000003"],
} as const;

/** The key of the new WhatsApp card on Today (the story's selectors find it by this). */
export const MESSAGE_KEY = `outbox_approval-${IDS.message}`;

/** The new lead and what was said (Telugu: the customer wrote in Telugu, the assistant answers in Telugu; the English is the gloss the card shows under it). */
export const LEAD = { name: "Lakshmi", city: "Hyderabad" } as const;
export const ASKED_TE = "నమస్కారం అండి. మా బొటీక్ కోసం 40 పట్టు చీరలు కావాలి. ధరలు చెప్పగలరా?";
export const REPLY_TE = "నమస్కారం లక్ష్మి గారు! మా దగ్గర కంచి పట్టు చీరలు ఒక్కొక్కటి ₹8,500, బనారసి పట్టు చీరలు ₹6,200. 40 చీరల కొటేషన్ ఈ రోజే పంపిస్తాము. ఫోటోలు కూడా పంపమంటారా?";
export const REPLY_EN = "Namaskaram Lakshmi garu! Our Kanchi silk sarees are ₹8,500 each and Banarasi silk sarees ₹6,200. We will send the quote for 40 sarees today. Shall we send photos too?";
export const ANSWER_TE = "అవునండి, ఫోటోలు పంపండి. ధన్యవాదాలు!";

/** A promise React can read at once (`use()` sees it settled): the "Done while you slept" card then never flashes its loading lines when the screen is drawn again. */
function settled<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const TEAM: AgentRow[] = [
  { agent: "main", state: "idle", job: "Coordinates the other helpers.", last_event: null },
  { agent: "lead_finder", state: "idle", job: "Finds new businesses that may want to buy.", last_event: null },
  { agent: "researcher", state: "idle", job: "Reads public pages about a lead and writes down what it finds, with sources.", last_event: null },
  { agent: "quote_writer", state: "idle", job: "Prepares a quote from the prices you set. A person approves it.", last_event: null },
  { agent: "followup_desk", state: "idle", job: "Drafts follow-up messages. A person approves and sends them.", last_event: null },
  { agent: "order_desk", state: "idle", job: "Keeps each order's steps, payments and refunds in order.", last_event: null },
];

/** Where the story is on Today: the calm morning, the new WhatsApp lead on top, and the end ("Done while you slept", the new draft quote waiting). */
export type TodayPhase = "calm" | "lead" | "done";

function needs(now: number, base: string, phase: TodayPhase): NeedsCard[] {
  const quote: NeedsCard = { type: "item", key: `quote_approval-${IDS.quote}`, at: at(now, 52), item: { kind: "quote_approval", id: IDS.quote, customer: "Kalyani Textiles", city: "Vijayawada", agent: "quote_writer", summary: "Quote 4 for ₹38,500.00 is ready for your approval.", at: at(now, 52), amount_paise: 3_850_000, href: `${base}/quotes` } };
  const followup: NeedsCard = { type: "item", key: `followup_due-${IDS.followup}`, at: at(now, 140), item: { kind: "followup_due", id: IDS.followup, customer: "Anjali Boutique", city: "Hyderabad", agent: "followup_desk", summary: "A follow-up to Anjali Boutique is due today.", at: at(now, 140), amount_paise: null, href: `${base}/followups` } };
  const message: NeedsCard = {
    type: "outbox",
    key: MESSAGE_KEY,
    at: at(now, 1),
    id: IDS.message,
    customer: LEAD.name,
    city: LEAD.city,
    message: { text: REPLY_TE, language: "te", category: "reply_to_inbound", flags: ["money"], reasonText: "Mentions a price", gloss: REPLY_EN, media: [] },
  };
  const made: NeedsCard = { type: "item", key: `quote_approval-${IDS.newQuote}`, at: at(now, 0), item: { kind: "quote_approval", id: IDS.newQuote, customer: "Mallige Silk Boutique", city: "Bengaluru", agent: "quote_writer", summary: "Quote 5 for ₹3,05,500.00 is ready for your approval.", at: at(now, 0), amount_paise: 30_550_000, href: `${base}/quotes` } };
  if (phase === "lead") return [message, quote, followup];
  if (phase === "done") return [made, quote, followup];
  return [quote, followup];
}

/** "Done while you slept": what went out overnight (the reply the owner just approved counts at the end). */
function digest(phase: TodayPhase): Digest {
  const replies = phase === "done" ? 7 : 6;
  return { state: "ready", sent: replies + 6, held: 0, lines: [{ kind: "reply_to_inbound", n: replies }, { kind: "followup", n: 4 }, { kind: "visit", n: 2 }] };
}

const DIGESTS: Record<TodayPhase, Promise<Digest>> = { calm: settled(digest("calm")), lead: settled(digest("lead")), done: settled(digest("done")) };

/** Today, as `TodayView` draws it, for one phase of the story. */
export function todayData(now: number, base: string, phase: TodayPhase): TodayData {
  const list = needs(now, base, phase);
  // the next half hour, an hour and a half from now: one visit booked for later this morning
  const visitAt = new Date(Math.ceil((now + 90 * MIN) / (30 * MIN)) * 30 * MIN).toISOString();
  return {
    cards: { waiting: list.length, money_held_paise: null, orders_open: 3 },
    needs: list,
    recent: [],
    team: TEAM,
    deskTeam: null,
    store: { state: "ready", visits: [{ id: IDS.visit, starts_at: visitAt, who: "Meena K.", extra: 2, topic: "Bridal sarees", status: "confirmed", here: false }], slots: "free", nextFree: null },
    week: null,
    sending: null,
    digest: DIGESTS[phase],
  };
}

const out = (id: string, when: string, text: string, over: Partial<ThreadItem> = {}): ThreadItem => ({ direction: "out", id, at: when, text, status: "sent", reason: null, delivery: "delivered", delivery_error: null, failure_code: null, photos: 0, ...over });
const inbound = (id: string, when: string, text: string): ThreadItem => ({ direction: "in", id, at: when, text, status: null, reason: null, delivery: null, delivery_error: null, failure_code: null, photos: 0 });

/** The WhatsApp chat with the new lead after the reply was approved; `answered` adds her answer. Newest first, as the API sends them. */
export function chatThread(now: number, answered: boolean): Thread {
  const items: ThreadItem[] = [out(IDS.message, at(now, 0), REPLY_TE), inbound("d0d0d0d0-0008-4000-8000-000000000001", at(now, 3), ASKED_TE)];
  if (answered) items.unshift(inbound("d0d0d0d0-0008-4000-8000-000000000002", at(now, -0.5), ANSWER_TE));
  return { lead_id: IDS.lead, name: LEAD.name, display_name: LEAD.name, stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: new Date(now + 23 * 60 * MIN).toISOString(), next_before: null, items };
}

/** What the owner asks the Lead Finder (typed into its box on screen, a letter at a time, as the step begins). */
export const FINDER_TEXT = "find new boutiques in Jayanagar, Bengaluru";

const SEARCH: Omit<Search, "state" | "counts" | "found" | "approvedAt" | "finishedAt" | "costPaise"> = {
  id: IDS.search,
  query: "Boutiques",
  area: "Jayanagar, Bengaluru",
  categoryHint: "retailer",
  maxResults: 20,
  // not "fixture": that word draws the "made-up businesses" label of the demo workspaces; the attribution is left out because these businesses are invented, not Google's
  provider: "places",
  sku: "places.text_search",
  estCostPaise: 3_400,
  costIsEstimate: true,
  sourceLabel: "Lead Finder",
  searchesLeftToday: 4,
  attribution: null,
  createdAt: "",
};
export function plannedSearch(now: number): Search {
  return { ...SEARCH, createdAt: at(now, 0), state: "planned", counts: null, found: 0, approvedAt: null, finishedAt: null, costPaise: 0 };
}
export function doneSearch(now: number): Search {
  return { ...SEARCH, createdAt: at(now, 0), state: "done", found: 16, costPaise: 3_400, approvedAt: at(now, 0), finishedAt: at(now, 0), counts: { found: 16, new: 16, duplicates: 0, call_ready: 5, needs_owner: 3, skipped: 8, researching: 0, duplicate_customer: 0, duplicate_company: 0, duplicate_prospect: 0, duplicate_suppressed: 0 } };
}

const prospect = (now: number, over: Partial<Prospect> & Pick<Prospect, "id" | "name">): Prospect => ({
  searchId: IDS.search,
  detailsAvailable: true,
  category: "Boutique",
  area: "Jayanagar",
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  lat: null,
  lng: null,
  source: "google_maps",
  sourceLabel: "Lead Finder · Jayanagar, Bengaluru",
  attribution: null,
  status: "call_ready",
  decisionReason: "fit_high",
  fitScore: 80,
  fitReason: null,
  stockMatch: { matched: ["Kanchi silk sarees", "Banarasi silk sarees"], low: [], enough: true },
  ownerApproved: false,
  suppressed: false,
  askAfter: null,
  lastContactedAt: null,
  leadId: null,
  qualification: null,
  createdAt: at(now, 0),
  updatedAt: at(now, 0),
  ...over,
});

/** The businesses the search found, best fit first (the first one gets the practice call). */
export function prospects(now: number): Prospect[] {
  return [
    prospect(now, { id: IDS.prospects[0], name: "Mallige Silk Boutique", area: "4th Block, Jayanagar", rating: 4.6, reviewCount: 184, fitScore: 88 }),
    prospect(now, { id: IDS.prospects[1], name: "Ananya Sarees & Boutique", area: "9th Block, Jayanagar", rating: 4.4, reviewCount: 96, fitScore: 79 }),
    prospect(now, { id: IDS.prospects[2], name: "Navya Designer Boutique", area: "3rd Block, Jayanagar", rating: 4.2, reviewCount: 38, status: "needs_owner", decisionReason: "first_calls", fitScore: 70, stockMatch: { matched: ["Banarasi silk sarees"], low: [], enough: true } }),
  ];
}

const KANCHI = { item: "Kanchi silk saree, zari border", itemTypeCode: "saree", unit: "piece", price: 850_000, said: "about 25" };
const BANARASI = { item: "Banarasi silk saree", itemTypeCode: "saree", unit: "piece", price: 620_000, said: "about 15" };

/** The practice call with the first business (simulated: nothing is dialled); it qualifies, so its draft quote opens under it. */
export function practiceCall(now: number): PracticeCall {
  const p = { ...prospects(now)[0], status: "qualified" as const, leadId: IDS.prospectLead };
  return {
    simulated: true,
    callId: IDS.call,
    prospect: p,
    persona: "interested",
    language: "en",
    outcome: "qualified",
    endReason: "goodbye",
    summary: "About: Shwetha, the owner, is stocking up for the wedding season: about 25 Kanchi silk sarees and 15 Banarasi. She wants the quote on WhatsApp and may order this week.",
    whatsappOk: true,
    pitched: ["Kanchi silk sarees", "Banarasi silk sarees"],
    quoteSuggestion: [
      { item: KANCHI.item, unit: KANCHI.unit, pricePaise: KANCHI.price, moq: 10, quantitySaid: KANCHI.said },
      { item: BANARASI.item, unit: BANARASI.unit, pricePaise: BANARASI.price, moq: 10, quantitySaid: BANARASI.said },
    ],
    transcript: [
      { who: "assistant", text: "Namaskara! I am calling for Sri Venkateswara Silks, Vijayawada. Am I speaking with the owner of Mallige Silk Boutique?", t: 0 },
      { who: "business", text: "Yes, Shwetha here. Tell me.", t: 6 },
      { who: "assistant", text: "We supply Kanchi and Banarasi silk sarees wholesale. Are you stocking up for the wedding season?", t: 9 },
      { who: "business", text: "Yes. Kanchi silk sells best here, I need about 25. Maybe 15 Banarasi also.", t: 16 },
      { who: "assistant", text: "Our Kanchi silk with zari border is ₹8,500 a piece, from 10 pieces. Shall I send the quote on WhatsApp?", t: 24 },
      { who: "business", text: "Yes, send it on WhatsApp. If the price is right I will order this week.", t: 33 },
    ],
    evals: {},
  };
}

const LINES = [
  { item: KANCHI.item, itemTypeCode: KANCHI.itemTypeCode, qty: 25, unitPricePaise: KANCHI.price, quantitySaid: KANCHI.said },
  { item: BANARASI.item, itemTypeCode: BANARASI.itemTypeCode, qty: 15, unitPricePaise: BANARASI.price, quantitySaid: BANARASI.said },
];
/** The draft quote's preview: each line at the catalogue's own price (the numbers are fixed here, never worked out by a model). */
export const QUOTE_PREVIEW: QuoteDraftView = { prospectId: IDS.prospects[0], leadId: IDS.prospectLead, ready: true, made: false, quoteId: IDS.newQuote, enquiryId: null, lines: LINES, leftOut: [] };
/** 25 x ₹8,500 + 15 x ₹6,200 = ₹3,05,500: a draft only, waiting for the owner's approval on Today. */
export const QUOTE_MADE: QuoteDraftMade = { quoteId: IDS.newQuote, quoteNo: 5, enquiryId: IDS.enquiry, status: "draft", totalPaise: 30_550_000, needsOwnerApproval: true, lines: LINES, leftOut: [], replayed: false };
