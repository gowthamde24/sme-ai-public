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

type Stored = { notes: string; version: number; history: { version: number; notes: string; at: string }[] };
const memory = new Map<string, Stored>();
const previews = new Map<string, { notes: string; at: number }>();

export function mockApi(tenantId: string): ContextApi {
  const store = (): Stored => {
    let s = memory.get(tenantId);
    if (!s) memory.set(tenantId, (s = { notes: "", version: 0, history: [] }));
    return s;
  };
  const state = (s: Stored): ContextState => ({ notes: s.notes, version: s.version, updatedAt: s.version ? new Date().toISOString() : null, updatedBy: s.version ? { id: "mock", name: "You" } : null, prompts: PROMPTS, usedBy: ["chats", "calls", "ask", "drafts"] });
  const write = (s: Stored, notes: string): ContextState => {
    if (notes !== s.notes) {
      s.version += 1;
      s.notes = notes;
      s.history.unshift({ version: s.version, notes, at: new Date().toISOString() });
    }
    return state(s);
  };
  const fail = <T>(error: ContextError): Done<T> => ({ ok: false, error });
  return {
    get: async () => ({ ok: true, data: state(store()) }),
    put: async (notes, expected) => {
      const s = store();
      if (notes.length > NOTES_MAX) return fail("toolarge");
      return expected !== s.version ? fail("changed") : { ok: true, data: write(s, notes) };
    },
    versions: async () => ({ ok: true, data: store().history.slice(0, 20).map((h) => ({ version: h.version, updatedAt: h.at, updatedBy: "You", size: h.notes.length, change: "" })) }),
    versionText: async (v) => {
      const h = store().history.find((x) => x.version === v);
      return h ? { ok: true, data: h.notes } : fail("down");
    },
    restore: async (v) => {
      const s = store();
      const h = s.history.find((x) => x.version === v);
      return h ? { ok: true, data: write(s, h.notes) } : fail("down");
    },
    understand: async (i) => {
      const text = (i.kind === "paste" ? i.text : i.kind === "voice" ? "We deliver within the city. Payment: half in advance." : `Price list from ${i.filename ?? "the file"}:\nPaver blocks: 38 rupees each`) ?? "";
      if (text.trim() === "") return fail("unreadable");
      const id = `mock-${Math.random().toString(36).slice(2, 12)}`;
      const md = `## Notes\n${text.trim()}`;
      previews.set(id, { notes: md, at: Date.now() });
      return { ok: true, data: { previewId: id, understood: [{ section: "other", text: text.trim().slice(0, 4000) }], notesMarkdown: md, source: { kind: i.kind, filename: i.filename ?? null }, warnings: [], expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } };
    },
    save: async (id, notes, mode, expected) => {
      const s = store();
      if (!previews.has(id)) return fail("expired");
      if (expected !== s.version) return fail("changed");
      previews.delete(id);
      return { ok: true, data: write(s, mode === "replace" || s.notes === "" ? notes : `${s.notes.trimEnd()}\n\n${notes}`.slice(0, NOTES_MAX)) };
    },
    test: async (question) => {
      const s = store();
      const asksPrice = /price|cost|rate|how much|ఎంత|कितना|ಎಷ್ಟು/i.test(question);
      const line = s.notes.split("\n").find((l) => /\d/.test(l) && l.trim() !== "");
      if (asksPrice && !line) return { ok: true, data: { answer: "", language: "en", used: [], wouldHandOver: true, reason: "asked_about_money" } };
      const hit = s.notes.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#") && question.toLowerCase().split(/\s+/).some((w) => w.length > 3 && l.toLowerCase().includes(w)));
      return { ok: true, data: { answer: hit ? hit.trim() : "Let me check with the owner and get back to you.", language: "en", used: hit ? [{ from: "notes", snippet: hit.trim().slice(0, 200) }] : [], wouldHandOver: !hit, reason: hit ? null : "unsure" } };
    },
  };
}

export const apiFor = (mode: ScreenMode, token: string, tenantId: string): ContextApi | null => (mode === "mock" ? mockApi(tenantId) : mode === "on" ? liveApi(token, tenantId) : null);
export const contextMode = (): ScreenMode => aboutBusinessScreens();
