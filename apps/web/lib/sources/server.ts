import { ApiAuthError } from "@/lib/api/client";
import { getCards, getEmailAddress, getWebsite, indiaMartDisconnect, indiaMartKey, metaConnect, metaDisconnect, metaPages, metaSelect, disconnectCard, resumeCard, rotateEmailAddress, sourceErrorOf, testCard } from "@/lib/api/source-cards";
import { readJar, writeJar } from "@/lib/mock/jar";
import { sourceCardsScreens, type ScreenMode } from "@/lib/screens/flag";

import type { Card, Done, EmailAddress, MetaPage, TestResult, WebsiteSnippet } from "./types";

/** The one door the cards' route and the sources page go through: the API (`1`) or a stand-in in the memory of this server (`mock`, nothing leaves the process). Every call ends in `Done`: the data, or a closed word. */
export type SourcesApi = {
  cards(): Promise<Done<Card[]>>;
  metaConnect(): Promise<Done<string>>;
  metaPages(): Promise<Done<MetaPage[]>>;
  metaSelect(pageId: string): Promise<Done<null>>;
  metaDisconnect(): Promise<Done<null>>;
  indiaMartKey(key: string): Promise<Done<{ status: "connected" | "needs_attention"; hint: string }>>;
  indiaMartDisconnect(): Promise<Done<null>>;
  email(rotate: boolean): Promise<Done<EmailAddress>>;
  website(): Promise<Done<WebsiteSnippet>>;
  resume(card: string): Promise<Done<null>>;
  /** One marked test lead for a card (never real data). */
  test(card: string): Promise<Done<TestResult>>;
  /** The quiet "Disconnect" of a card (a key or login is forgotten, an address is paused; nothing is deleted). */
  disconnect(card: string): Promise<Done<null>>;
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
  metaConnect: () => wrap(() => metaConnect(token, tenantId)),
  metaPages: () => wrap(() => metaPages(token, tenantId)),
  metaSelect: (id) => wrap(async () => (await metaSelect(token, tenantId, id), null)),
  metaDisconnect: () => wrap(async () => (await metaDisconnect(token, tenantId), null)),
  indiaMartKey: (k) => wrap(() => indiaMartKey(token, tenantId, k)),
  indiaMartDisconnect: () => wrap(async () => (await indiaMartDisconnect(token, tenantId), null)),
  email: (rotate) => wrap(() => (rotate ? rotateEmailAddress(token, tenantId) : getEmailAddress(token, tenantId))),
  website: () => wrap(() => getWebsite(token, tenantId)),
  resume: (card) => wrap(async () => (await resumeCard(token, tenantId, card), null)),
  test: (card) => wrap(() => testCard(token, tenantId, card)),
  disconnect: (card) => wrap(async () => (await disconnectCard(token, tenantId, card), null)),
});

/** The stand-in (mock mode) keeps its few made-up facts in ONE small cookie of the browser (lib/mock/jar.ts), like the other test screens: a server memory would be lost between the instances of a Cloud Run service. */
const COOKIE = "sme_cards_mock";
/** `on` = the cards turned on; `last` = minutes since the last lead of a card (test leads leave the mock a mark, as the real ones do for the owner's eye only); `rotations` = how often the mail address was changed. */
type Mock = { t: string; on: string[]; last: Record<string, number>; rotations: number };
const TURNABLE = ["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets"];
const parseMock = (v: unknown): Mock | null => {
  const r = v as Partial<Mock> | null;
  if (!r || typeof r.t !== "string") return null;
  const on = Array.isArray(r.on) ? r.on.filter((x): x is string => typeof x === "string" && TURNABLE.includes(x)) : [];
  const last: Record<string, number> = {};
  for (const [k, n] of Object.entries(r.last && typeof r.last === "object" ? r.last : {})) if (TURNABLE.includes(k) && typeof n === "number") last[k] = Math.min(Math.max(Math.trunc(n), 0), 99999);
  return { t: r.t, on, last, rotations: typeof r.rotations === "number" ? Math.min(Math.max(Math.trunc(r.rotations), 0), 99) : 0 };
};
export function mockApi(tenantId: string): SourcesApi {
  const load = async (): Promise<Mock> => {
    const m = await readJar<Mock | null>(COOKIE, parseMock, null);
    return m && m.t === tenantId ? m : { t: tenantId, on: [], last: {}, rotations: 0 };
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
          costPerLeadPaise: null,
          problem: null,
          available: true,
        };
      });
      const base = { state: "connected" as const, receivedTotal: 0, canTest: false, canDisconnect: false, testLabel: null, costPerLeadPaise: null, problem: null, available: true, received7d: 0, lastReceivedAt: null };
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
    email: async (rotate) => {
      const x = await load();
      if (rotate) x.rotations += 1;
      x.on = [...new Set([...x.on, "email_forward"])];
      await save(x);
      return ok({ address: address(x), guide: [{ step: 1, text: "Open Gmail and search for the lead e-mail." }, { step: 2, text: "Choose Filter messages like this, then Forward it to the address above." }], portals: ["JustDial", "Sulekha"], confirmation: null });
    },
    resume: async (card) => (await turn(card, true), ok(null)),
    website: async () => (await turn("website", true), ok({ snippet: `<form method="post" action="https://example.test/v1/lead-intake/mock"><input name="name"><input name="phone"><button>Send</button></form>`, formLink: "https://example.test/f/mock" })),
    test: async (card) => {
      const x = await load();
      if (!x.on.includes(card)) return { ok: false, error: "notconnected" };
      if (!CARD[card]?.test) return { ok: false, error: "notavailable" };
      if (card === "indiamart" || card === "google_ads" || card === "sheets") return ok({ result: card === "indiamart" ? "key_valid" : "reachable", message: card === "indiamart" ? "Your IndiaMART key is accepted." : "The address answers. Nothing was added to your Leads.", leadId: null });
      x.last[card] = 0;
      await save(x);
      return ok({ result: card === "meta" ? "waiting_for_provider" : "lead_created", message: card === "meta" ? "Asked Facebook for a test lead. It can take a minute." : "A test lead arrived in your Leads.", leadId: "00000000-0000-4000-8000-000000000001" });
    },
    disconnect: async (card) => (await turn(card, false), ok(null)),
  };
}

export const sourcesApiFor = (mode: ScreenMode, token: string, tenantId: string): SourcesApi | null => (mode === "mock" ? mockApi(tenantId) : mode === "on" ? liveApi(token, tenantId) : null);
export const cardsMode = (): ScreenMode => sourceCardsScreens();
