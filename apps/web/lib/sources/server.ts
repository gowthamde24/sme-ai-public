import { ApiAuthError } from "@/lib/api/client";
import { getCards, getEmailAddress, getWebsite, indiaMartDisconnect, indiaMartKey, metaConnect, metaDisconnect, metaPages, metaSelect, rotateEmailAddress, sourceErrorOf } from "@/lib/api/source-cards";
import { readJar, writeJar } from "@/lib/mock/jar";
import { sourceCardsScreens, type ScreenMode } from "@/lib/screens/flag";

import type { Card, Done, EmailAddress, MetaPage, WebsiteSnippet } from "./types";

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
});

/** The stand-in (mock mode) keeps its few made-up facts in ONE small cookie of the browser (lib/mock/jar.ts), like the other test screens: a server memory would be lost between the instances of a Cloud Run service. */
const COOKIE = "sme_cards_mock";
type Mock = { t: string; indiamart: "ok" | null; meta: boolean; mail: boolean; rotations: number };
const parseMock = (v: unknown): Mock | null => {
  const r = v as Partial<Mock> | null;
  return r && typeof r.t === "string" ? { t: r.t, indiamart: r.indiamart === "ok" ? "ok" : null, meta: r.meta === true, mail: r.mail === true, rotations: typeof r.rotations === "number" ? Math.min(Math.max(Math.trunc(r.rotations), 0), 99) : 0 } : null;
};
export function mockApi(tenantId: string): SourcesApi {
  const load = async (): Promise<Mock> => {
    const m = await readJar<Mock | null>(COOKIE, parseMock, null);
    return m && m.t === tenantId ? m : { t: tenantId, indiamart: null, meta: false, mail: false, rotations: 0 };
  };
  const save = async (m: Mock) => void (await writeJar(COOKIE, m));
  const ok = <T,>(data: T): Done<T> => ({ ok: true, data });
  const address = (m: Mock) => `mock${tenantId.slice(0, 6)}${m.rotations}@leads.example.test`;
  return {
    cards: async () => {
      const x = await load();
      const base = { received7d: 0, lastReceivedAt: null, problem: null, available: true };
      return ok<Card[]>([
        { kind: "meta", status: x.meta ? "connected" : "not_connected", headline: x.meta ? "Connected" : "Not connected", detail: x.meta ? "3 leads this week" : null, action: "oauth", ...base, received7d: x.meta ? 3 : 0 },
        { kind: "indiamart", status: x.indiamart ? "connected" : "not_connected", headline: x.indiamart ? "Connected" : "Not connected", detail: x.indiamart ? "Nothing received for 7 days" : null, action: "paste_key", ...base },
        { kind: "email_forward", status: x.mail ? "connected" : "not_connected", headline: x.mail ? "Connected" : "Not connected", detail: null, action: "copy_address", ...base },
        { kind: "website", status: "not_connected", headline: "Not connected", detail: null, action: "copy_snippet", ...base },
        { kind: "files", status: "connected", headline: "Ready", detail: null, action: "upload", ...base },
        { kind: "whatsapp", status: "connected", headline: "Connected", detail: "5 chats became leads this week", action: "none", ...base },
        { kind: "missed_calls", status: "coming_soon", headline: "Coming soon", detail: null, action: "none", ...base, available: false },
      ]);
    },
    metaConnect: async () => ok("https://www.facebook.com/dialog/oauth?mock=1"),
    metaPages: async () => ok([{ id: "p1", name: "Sri Traders", selected: (await load()).meta }, { id: "p2", name: "Sri Traders Offers", selected: false }]),
    metaSelect: async () => {
      const x = await load();
      x.meta = true;
      await save(x);
      return ok(null);
    },
    metaDisconnect: async () => {
      const x = await load();
      x.meta = false;
      await save(x);
      return ok(null);
    },
    indiaMartKey: async (key) => {
      if (key.trim().length < 8) return { ok: false, error: "badkey" };
      const x = await load();
      x.indiamart = "ok"; // the key itself is not kept, even here
      await save(x);
      return ok({ status: "connected", hint: `...${key.trim().slice(-4)}` });
    },
    indiaMartDisconnect: async () => {
      const x = await load();
      x.indiamart = null;
      await save(x);
      return ok(null);
    },
    email: async (rotate) => {
      const x = await load();
      if (rotate) x.rotations += 1;
      x.mail = true;
      await save(x);
      return ok({ address: address(x), guide: [{ step: 1, text: "Open Gmail and search for the lead e-mail." }, { step: 2, text: "Choose Filter messages like this, then Forward it to the address above." }], portals: ["JustDial", "Sulekha"] });
    },
    website: async () => ok({ snippet: `<${"script"} src="https://example.test/lead.js" data-key="mock"></${"script"}>`, formLink: "https://example.test/f/mock" }),
  };
}

export const sourcesApiFor = (mode: ScreenMode, token: string, tenantId: string): SourcesApi | null => (mode === "mock" ? mockApi(tenantId) : mode === "on" ? liveApi(token, tenantId) : null);
export const cardsMode = (): ScreenMode => sourceCardsScreens();
