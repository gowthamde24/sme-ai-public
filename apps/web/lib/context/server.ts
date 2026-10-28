import { readJar, writeJar } from "@/lib/mock/jar";
import { aboutBusinessScreens, type ScreenMode } from "@/lib/screens/flag";
import { ApiAuthError } from "@/lib/api/client";
import { contextErrorOf, getContext, getVersions, getVersionText, putContext, restoreVersion, saveUnderstood, testContext, understand, type UnderstandInput } from "@/lib/api/context";
import { NOTES_MAX, SECTIONS, type ContextError, type ContextState, type Done, type TestAnswer, type Understood, type VersionItem } from "./types";

/**
 * The one door the screen's route and the settings page go through: the API (`1`) or a stand-in kept in the memory of this server (`mock`: for review and the pictures; nothing leaves the process). Every call ends in `Done`: the data, or a closed word the screen has a sentence for.
 */
export type ContextApi = {
  get(): Promise<Done<ContextState>>;
  put(notes: string, expected: number): Promise<Done<ContextState>>;
  versions(): Promise<Done<VersionItem[]>>;
  versionText(version: number): Promise<Done<string>>;
  restore(version: number): Promise<Done<ContextState>>;
  understand(input: UnderstandInput): Promise<Done<Understood>>;
  save(previewId: string, notes: string, mode: "append" | "replace", expected: number): Promise<Done<ContextState>>;
  test(question: string, language?: string): Promise<Done<TestAnswer>>;
};

const PROMPTS = SECTIONS.filter((s) => s !== "other").map((key) => ({ key, label: key, hint: "" }));

async function wrap<T>(run: () => Promise<T>): Promise<Done<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error; // the route answers 401: the person signs in again
    return { ok: false, error: contextErrorOf(error) };
  }
}

export function liveApi(token: string, tenantId: string): ContextApi {
  return {
    get: () => wrap(() => getContext(token, tenantId)),
    put: (notes, expected) => wrap(() => putContext(token, tenantId, notes, expected)),
    versions: () => wrap(() => getVersions(token, tenantId)),
    versionText: (v) => wrap(() => getVersionText(token, tenantId, v)),
    restore: (v) => wrap(() => restoreVersion(token, tenantId, v)),
    understand: (i) => wrap(() => understand(token, tenantId, i)),
    save: (id, notes, mode, expected) => wrap(() => saveUnderstood(token, tenantId, id, notes, mode, expected)),
    test: (q, l) => wrap(() => testContext(token, tenantId, q, l)),
  };
}

/**
 * The stand-in (mock mode) keeps its few made-up notes in ONE cookie of the browser (lib/mock/jar.ts), like the other test screens: a server memory would be lost between the instances of a Cloud Run service. A cookie is small, so the stand-in holds short notes
 * (about 1,200 characters) and the last three versions; longer ones are refused with "too large". The real API has no such limit (20,000).
 */
const COOKIE = "sme_ctx_mock";
const MOCK_NOTES = 1200;
type Jar = { t: string; n: string; v: number; h: { v: number; n: string }[]; p: { id: string; n: string } | null };
const parseJar = (v: unknown): Jar | null => {
  const r = v as Partial<Jar> | null;
  return r && typeof r.t === "string" && typeof r.n === "string" && typeof r.v === "number" && Array.isArray(r.h) ? { t: r.t, n: r.n.slice(0, MOCK_NOTES), v: Math.trunc(r.v), h: r.h.filter((x) => x && typeof x.v === "number" && typeof x.n === "string").slice(0, 3).map((x) => ({ v: x.v, n: x.n.slice(0, 150) })), p: r.p && typeof r.p.id === "string" && typeof r.p.n === "string" ? { id: r.p.id.slice(0, 40), n: r.p.n.slice(0, 500) } : null } : null;
};

export function mockApi(tenantId: string): ContextApi {
  const load = async (): Promise<Jar> => {
    const j = await readJar<Jar | null>(COOKIE, parseJar, null);
    return j && j.t === tenantId ? j : { t: tenantId, n: "", v: 0, h: [], p: null };
  };
  const state = (s: Jar): ContextState => ({ notes: s.n, version: s.v, updatedAt: s.v ? new Date().toISOString() : null, updatedBy: s.v ? { id: "mock", name: "You" } : null, prompts: PROMPTS, usedBy: ["chats", "calls", "ask", "drafts"] });
  const fail = <T>(error: ContextError): Done<T> => ({ ok: false, error });
  /** A new text makes a new version; the same text changes nothing. */
  const write = async (s: Jar, notes: string): Promise<Done<ContextState>> => {
    if (notes.length > MOCK_NOTES) return fail("toolarge");
    if (notes !== s.n) {
      s.v += 1;
      s.n = notes;
      s.h = [{ v: s.v, n: notes.slice(0, 150) }, ...s.h].slice(0, 3);
    }
    return (await writeJar(COOKIE, s)) ? { ok: true, data: state(s) } : fail("toolarge");
  };
  return {
    get: async () => ({ ok: true, data: state(await load()) }),
    put: async (notes, expected) => {
      const s = await load();
      return expected !== s.v ? fail("changed") : write(s, notes);
    },
    versions: async () => ({ ok: true, data: (await load()).h.map((h) => ({ version: h.v, updatedAt: new Date().toISOString(), updatedBy: "You", size: h.n.length, change: "" })) }),
    versionText: async (v) => {
      const h = (await load()).h.find((x) => x.v === v);
      return h ? { ok: true, data: h.n } : fail("down");
    },
    restore: async (v) => {
      const s = await load();
      const h = s.h.find((x) => x.v === v);
      return h ? write(s, h.n) : fail("down");
    },
    understand: async (i) => {
      const text = (i.kind === "paste" ? i.text : i.kind === "voice" ? "We deliver within the city. Payment: half in advance." : `Price list from ${i.filename ?? "the file"}:\nPaver blocks: 38 rupees each`) ?? "";
      if (text.trim() === "") return fail("unreadable");
      const s = await load();
      const id = `mock-${Math.random().toString(36).slice(2, 12)}`;
      const md = `## Notes\n${text.trim()}`.slice(0, 500);
      s.p = { id, n: md };
      await writeJar(COOKIE, s);
      return { ok: true, data: { previewId: id, understood: [{ section: "other", text: text.trim().slice(0, 400) }], notesMarkdown: md, source: { kind: i.kind, filename: i.filename ?? null }, warnings: [], expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } };
    },
    save: async (id, notes, mode, expected) => {
      const s = await load();
      if (!s.p || s.p.id !== id) return fail("expired");
      if (expected !== s.v) return fail("changed");
      s.p = null;
      return write(s, mode === "replace" || s.n === "" ? notes : `${s.n.trimEnd()}\n\n${notes}`);
    },
    test: async (question) => {
      const s = await load();
      const asksPrice = /price|cost|rate|how much|ఎంత|कितना|ಎಷ್ಟು/i.test(question);
      const line = s.n.split("\n").find((l) => /\d/.test(l) && l.trim() !== "");
      if (asksPrice && !line) return { ok: true, data: { answer: "", language: "en", used: [], wouldHandOver: true, reason: "asked_about_money" } };
      const hit = s.n.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#") && question.toLowerCase().split(/\s+/).some((w) => w.length > 3 && l.toLowerCase().includes(w)));
      return { ok: true, data: { answer: hit ? hit.trim() : "Let me check with the owner and get back to you.", language: "en", used: hit ? [{ from: "notes", snippet: hit.trim().slice(0, 200) }] : [], wouldHandOver: !hit, reason: hit ? null : "unsure" } };
    },
  };
}

export const apiFor = (mode: ScreenMode, token: string, tenantId: string): ContextApi | null => (mode === "mock" ? mockApi(tenantId) : mode === "on" ? liveApi(token, tenantId) : null);
export const contextMode = (): ScreenMode => aboutBusinessScreens();
