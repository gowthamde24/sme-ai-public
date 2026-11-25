import { ApiAuthError } from "@/lib/api/client";
import { pullIndiaMart } from "@/lib/api/lead-sources";
import type { PullResult } from "@/lib/lead-desk/sources/types";
import { getCards, getEmailAddress, getPortals, getWebsite, indiaMartDisconnect, indiaMartKey, metaConnect, metaDisconnect, metaPages, metaSelect, connectCard, disconnectCard, resumeCard, rotateCard, setCardCost, rotateEmailAddress, sourceErrorOf, testCard } from "@/lib/api/source-cards";
import { readJar, writeJar } from "@/lib/mock/jar";
import { sourceCardsScreens, type ScreenMode } from "@/lib/screens/flag";

import { COST_SOURCE, type Card, type ConnectInfo, type Done, EmailAddress, MetaPage, Portal, TestResult, WebsiteSnippet } from "./types";

/** The one door the cards' route and the sources page go through: the API (`1`) or a stand-in in the memory of this server (`mock`, nothing leaves the process). Every call ends in `Done`: the data, or a closed word. */
export type SourcesApi = {
  cards(): Promise<Done<Card[]>>;
  /** `consent` (JOBS): the person ticked the consent sentence; the API gets `consent_confirmed: true`. */
  metaConnect(consent?: boolean): Promise<Done<string>>;
  metaPages(): Promise<Done<MetaPage[]>>;
  metaSelect(pageId: string): Promise<Done<null>>;
  metaDisconnect(): Promise<Done<null>>;
  indiaMartKey(key: string): Promise<Done<{ status: "connected" | "needs_attention"; hint: string }>>;
  indiaMartDisconnect(): Promise<Done<null>>;
  /** "Pull now": ask IndiaMART for the enquiries since the last pull (the scheduled pull comes later). */
  pull(): Promise<Done<PullResult>>;
  email(rotate: boolean): Promise<Done<EmailAddress>>;
  website(): Promise<Done<WebsiteSnippet>>;
  /** The portals that have no connector of their own, each with the message to send their team (the e-mail card shows them). */
  portals(): Promise<Done<Portal[]>>;
  resume(card: string): Promise<Done<null>>;
  /** One marked test lead for a card (never real data). */
  test(card: string): Promise<Done<TestResult>>;
  /** The quiet "Disconnect" of a card (a key or login is forgotten, an address is paused; nothing is deleted). */
  disconnect(card: string): Promise<Done<null>>;
  /** The website form's own steps: make its address (connect) and change it (rotate). */
  connect(card: string, consent?: boolean): Promise<Done<ConnectInfo | null>>;
  rotate(card: string): Promise<Done<ConnectInfo | null>>;
  /** What one lead from this card's source costs, in paise (Reports use it for the cost per visit). */
  cost(source: string, paise: number): Promise<Done<null>>;
};

async function wrap<T>(run: () => Promise<T>): Promise<Done<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error; // the route answers 401
    return { ok: false, error: sourceErrorOf(error) };
  }
}

export const liveApi = (token: string, tenantId: string): SourcesApi => ({
  cards: () => wrap(() => getCards(token, tenantId)),
  metaConnect: (consent) => wrap(() => metaConnect(token, tenantId, consent === true)),
  metaPages: () => wrap(() => metaPages(token, tenantId)),
  metaSelect: (id) => wrap(async () => (await metaSelect(token, tenantId, id), null)),
  metaDisconnect: () => wrap(async () => (await metaDisconnect(token, tenantId), null)),
  indiaMartKey: (k) => wrap(() => indiaMartKey(token, tenantId, k)),
  indiaMartDisconnect: () => wrap(async () => (await indiaMartDisconnect(token, tenantId), null)),
  pull: () => wrap(() => pullIndiaMart(token, tenantId)),
  email: (rotate) => wrap(() => (rotate ? rotateEmailAddress(token, tenantId) : getEmailAddress(token, tenantId))),
  website: () => wrap(() => getWebsite(token, tenantId)),
  portals: () => wrap(() => getPortals(token, tenantId)),
  resume: (card) => wrap(async () => (await resumeCard(token, tenantId, card), null)),
  test: (card) => wrap(() => testCard(token, tenantId, card)),
  disconnect: (card) => wrap(async () => (await disconnectCard(token, tenantId, card), null)),
  connect: (card, consent) => wrap(() => connectCard(token, tenantId, card, consent === true)),
  rotate: (card) => wrap(() => rotateCard(token, tenantId, card)),
  cost: (source, paise) => wrap(async () => (await setCardCost(token, tenantId, source, paise), null)),
});

/** The stand-in (mock mode) keeps its few made-up facts in ONE small cookie of the browser (lib/mock/jar.ts), like the other test screens: a server memory would be lost between the instances of a Cloud Run service. */
const COOKIE = "sme_cards_mock";
/** `on` = the cards turned on; `last` = minutes since the last lead of a card (test leads leave the mock a mark, as the real ones do for the owner's eye only); `rotations` = how often the mail address was changed. */
type Mock = { t: string; on: string[]; last: Record<string, number>; rotations: number; cost: Record<string, number> };
const TURNABLE = ["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets"];
const parseMock = (v: unknown): Mock | null => {
  const r = v as Partial<Mock> | null;
  if (!r || typeof r.t !== "string") return null;
  const on = Array.isArray(r.on) ? r.on.filter((x): x is string => typeof x === "string" && TURNABLE.includes(x)) : [];
  const last: Record<string, number> = {};
  for (const [k, n] of Object.entries(r.last && typeof r.last === "object" ? r.last : {})) if (TURNABLE.includes(k) && typeof n === "number") last[k] = Math.min(Math.max(Math.trunc(n), 0), 99999);
  const cost: Record<string, number> = {};
  for (const [k, n] of Object.entries(r.cost && typeof r.cost === "object" ? r.cost : {})) if (Object.values(COST_SOURCE).includes(k) && typeof n === "number") cost[k] = Math.min(Math.max(Math.trunc(n), 0), 10_000_000);
  return { t: r.t, on, last, cost, rotations: typeof r.rotations === "number" ? Math.min(Math.max(Math.trunc(r.rotations), 0), 99) : 0 };
};
const MOCK_ASK = (name: string) => `Hello ${name} team. I sell on ${name} and I want my new enquiries to reach my business tool by themselves. Please switch on lead delivery for my account to this e-mail address: (your lead e-mail address from the Lead sources page). Thank you.`;
const PORTALS_MOCK: Portal[] = [["justdial", "JustDial"], ["99acres", "99acres"], ["magicbricks", "MagicBricks"], ["housing", "Housing"], ["sulekha", "Sulekha"], ["tradeindia", "TradeIndia"]].map(([id, name]) => ({ id, name, askText: MOCK_ASK(name) }));
export function mockApi(tenantId: string): SourcesApi {
  const load = async (): Promise<Mock> => {
    const m = await readJar<Mock | null>(COOKIE, parseMock, null);
    return m && m.t === tenantId ? m : { t: tenantId, on: [], last: {}, cost: {}, rotations: 0 };
  };
  const save = async (m: Mock) => void (await writeJar(COOKIE, m));
  const ok = <T,>(data: T): Done<T> => ({ ok: true, data });
  const turn = async (kind: string, on: boolean) => {
    const x = await load();
    x.on = on ? [...new Set([...x.on, kind])] : x.on.filter((k) => k !== kind);
    if (!on) delete x.last[kind];
    await save(x);
  };
  const address = (m: Mock) => `mock${tenantId.slice(0, 6)}${m.rotations}@leads.example.test`;
  const CARD: Record<string, { action: Card["action"]; test: string | null; disconnect: boolean }> = {
    website: { action: "copy_snippet", test: "Send a test lead to your Leads", disconnect: true },
    missed_calls: { action: "none", test: "Send a test missed call", disconnect: true },
    meta: { action: "oauth", test: "Ask Facebook for a test lead", disconnect: true },
    click_to_whatsapp: { action: "none", test: "Send a test ad enquiry", disconnect: true },
    indiamart: { action: "paste_key", test: "Check my IndiaMART key", disconnect: true },
    email_forward: { action: "copy_address", test: "Send a test e-mail lead", disconnect: true },
    google_ads: { action: "copy_address", test: "Check the Google Ads address", disconnect: true },
    sheets: { action: "copy_address", test: "Check my sheet link", disconnect: true },
  };
  /** The kinds whose address is shown only once (missed calls, Google Ads); the website form shows its own snippet instead. */
  const shownOnce = (card: string, n: number): ConnectInfo | null =>
    card === "missed_calls" || card === "google_ads" || card === "email_forward" ? { fields: [{ label: card === "missed_calls" ? "Address for Missed calls" : card === "google_ads" ? "Address for Google Ads lead form" : "Forward portal e-mails to", value: card === "email_forward" ? `leads+mock${n}@leads.example.test` : `https://example.test/v1/lead-intake/${card}-${n}` }], steps: card === "email_forward" ? ["Open the portal's lead e-mail settings, or your mail filter.", "Choose to forward every lead e-mail.", "Paste this address as the one to forward to, and save."] : ["Open the settings of your phone company or Google Ads.", "Find where a callback or webhook address goes.", "Paste this address there and save."] } : null;
  return {
    cards: async () => {
      const x = await load();
      const cards: Card[] = TURNABLE.map((kind) => {
        const on = x.on.includes(kind);
        const mins = x.last[kind];
        const got = mins !== undefined;
        return {
          kind: kind as Card["kind"],
          status: on ? "connected" : "not_connected",
          state: on ? (got ? "connected" : "waiting") : "off",
          headline: on ? "Connected" : "Not connected",
          detail: null,
          received7d: got ? 3 : 0,
          receivedTotal: got ? 3 : 0,
          lastReceivedAt: got ? new Date(Date.now() - mins * 60_000).toISOString() : null,
          action: CARD[kind].action,
          canTest: on && CARD[kind].test !== null,
          canDisconnect: on && CARD[kind].disconnect,
          testLabel: CARD[kind].test,
          costPerLeadPaise: x.cost[COST_SOURCE[kind]] ?? null,
          costSource: COST_SOURCE[kind],
          problem: null,
          available: true,
        };
      });
      const base = { state: "connected" as const, receivedTotal: 0, canTest: false, canDisconnect: false, testLabel: null, costPerLeadPaise: null, costSource: null, problem: null, available: true, received7d: 0, lastReceivedAt: null };
      cards.push({ kind: "files", status: "connected", headline: "Ready", detail: null, action: "upload", ...base }, { kind: "whatsapp", status: "connected", headline: "Connected", detail: "5 chats became leads this week", action: "none", ...base });
      return ok(cards);
    },
    metaConnect: async () => ok("https://www.facebook.com/dialog/oauth?mock=1"),
    metaPages: async () => ok([{ id: "p1", name: "Sri Traders", selected: (await load()).on.includes("meta") }, { id: "p2", name: "Sri Traders Offers", selected: false }]),
    metaSelect: async () => (await turn("meta", true), ok(null)),
    metaDisconnect: async () => (await turn("meta", false), ok(null)),
    indiaMartKey: async (key) => {
      if (key.trim().length < 8) return { ok: false, error: "badkey" };
      await turn("indiamart", true); // the key itself is not kept, even here
      return ok({ status: "connected", hint: `...${key.trim().slice(-4)}` });
    },
    indiaMartDisconnect: async () => (await turn("indiamart", false), ok(null)),
    pull: async () => {
      const x = await load();
      if (!x.on.includes("indiamart")) return { ok: false, error: "notconnected" };
      x.last.indiamart = 0;
      await save(x);
      return ok({ fetched: 3, created: 2, merged: 1, invalid: 0, existing: 0, window_start: new Date(Date.now() - 3600_000).toISOString(), window_end: new Date().toISOString() });
    },
    email: async (rotate) => {
      const x = await load();
      if (rotate) x.rotations += 1;
      x.on = [...new Set([...x.on, "email_forward"])];
      await save(x);
      return ok({ address: address(x), guide: [{ step: 1, text: "Open Gmail and search for the lead e-mail." }, { step: 2, text: "Choose Filter messages like this, then Forward it to the address above." }], portals: ["JustDial", "Sulekha"], confirmation: null });
    },
    portals: async () => ok(PORTALS_MOCK),
    resume: async (card) => (await turn(card, true), ok(null)),
    website: async () => {
      const x = await load();
      if (!x.on.includes("website")) return { ok: false, error: "notconnected" };
      return ok({ snippet: `<form method="post" action="https://example.test/v1/lead-intake/mock${x.rotations}"><input name="name"><input name="phone"><button>Send</button></form>`, formLink: "https://example.test/f/mock", webhookUrl: `https://example.test/v1/lead-intake/mock${x.rotations}` });
    },
    test: async (card) => {
      const x = await load();
      if (!x.on.includes(card)) return { ok: false, error: "notconnected" };
      if (!CARD[card]?.test) return { ok: false, error: "notavailable" };
      if (card === "indiamart" || card === "google_ads" || card === "sheets") return ok({ result: card === "indiamart" ? "key_valid" : "reachable", message: card === "indiamart" ? "Your IndiaMART key is accepted." : "The address answers. Nothing was added to your Leads.", leadId: null, portal: null });
      x.last[card] = 0;
      await save(x);
      return ok({ result: card === "meta" ? "waiting_for_provider" : "lead_created", message: card === "meta" ? "Asked Facebook for a test lead. It can take a minute." : "A test lead arrived in your Leads.", leadId: "00000000-0000-4000-8000-000000000001", portal: card === "email_forward" ? "JustDial" : null });
    },
    disconnect: async (card) => (await turn(card, false), ok(null)),
    connect: async (card) => {
      if (!CARD[card]) return { ok: false, error: "notavailable" };
      await turn(card, true);
      return ok(shownOnce(card, (await load()).rotations));
    },
    rotate: async (card) => {
      const x = await load();
      x.rotations += 1;
      await save(x);
      return ok(shownOnce(card, x.rotations));
    },
    cost: async (source, paise) => {
      if (!Object.values(COST_SOURCE).includes(source)) return { ok: false, error: "notavailable" };
      const x = await load();
      x.cost[source] = paise;
      await save(x);
      return ok(null);
    },
  };
}

export const sourcesApiFor = (mode: ScreenMode, token: string, tenantId: string): SourcesApi | null => (mode === "mock" ? mockApi(tenantId) : mode === "on" ? liveApi(token, tenantId) : null);
export const cardsMode = (): ScreenMode => sourceCardsScreens();
