import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/knowledge";
import { readJar, writeJar } from "@/lib/mock/jar";
import { leadsScreens } from "@/lib/screens/flag";

import { cleanFactText, MAX_FILE_BYTES, MAX_PASTE_CHARS, type Fact, type FactKind, type KDone, type KnowledgeRefusal, type KnowledgeSource } from "./knowledge";
import { EMPTY, MOCK_COOKIE, draftFrom, factOf, idFrom, parse, sourceOf, type KnowledgeMock } from "./knowledge-mock";

/**
 * Where the knowledge base lives (night 4, part A1): `mock` = lib/lead-desk/knowledge-mock.ts (a cookie), `on` = the API (lib/api/knowledge.ts), `off` = not there. A read that fails is `null`; a change answers in the closed words of
 * `KnowledgeRefusal`. An expired sign-in is not swallowed. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string };

export function refusalOf(error: unknown): KnowledgeRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.code === "source_too_large" || error.status === 413) return "too_large";
    if (error.code === "unsupported_type" || error.status === 415) return "unsupported";
    if (error.code === "unreadable_file") return "unreadable";
    if (error.code === "no_text_found") return "no_text";
    if (error.code === "reader_unavailable") return "reader";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return "invalid";
    if (error.status === 404) return "not_available";
  }
  return "down";
}
const state = () => readJar(MOCK_COOKIE, parse, EMPTY);
const keep = (s: KnowledgeMock) => writeJar(MOCK_COOKIE, s, 7);
const attempt = async <T>(run: () => Promise<T>): Promise<KDone<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: refusalOf(error) };
  }
};
const off = <T>(): KDone<T> => ({ ok: false, error: "not_available" });
const full = <T>(): KDone<T> => ({ ok: false, error: "invalid" });

export async function readKnowledge(ctx: Ctx): Promise<{ sources: KnowledgeSource[]; facts: Fact[] } | null> {
  const mode = leadsScreens();
  if (mode === "off") return null;
  if (mode === "mock") {
    const s = await state();
    return { sources: s.sources.filter((x) => !x.discarded).map((x) => sourceOf(x, s.facts)), facts: s.facts.map(factOf) };
  }
  try {
    const [sources, facts] = await Promise.all([api.listSources(ctx.token, ctx.tenantId), api.listFacts(ctx.token, ctx.tenantId)]);
    return { sources: sources.filter((x) => x.status !== "discarded"), facts };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function addPaste(ctx: Ctx, input: { sourceId: string; title: string; text: string }, now: Date = new Date()): Promise<KDone<KnowledgeSource>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  const text = input.text.trim();
  const title = input.title.trim();
  if (!text || !title || title.length > 120 || text.length > MAX_PASTE_CHARS) return full();
  if (mode === "mock") {
    const s = await state();
    if (s.sources.some((x) => x.id === input.sourceId)) return { ok: true, value: sourceOf(s.sources.find((x) => x.id === input.sourceId)!, s.facts) };
    const mine = { id: input.sourceId, title, kind: "paste" as const, filename: null, chars: text.length, createdAt: now.toISOString(), text: text.slice(0, 900), discarded: false };
    if (!(await keep({ ...s, sources: [...s.sources.slice(-2), mine] }))) return full();
    return { ok: true, value: sourceOf(mine, s.facts) };
  }
  return attempt(() => api.addPasteSource(ctx.token, ctx.tenantId, { sourceId: input.sourceId, title, text }));
}

export async function addFile(ctx: Ctx, input: { sourceId: string; title: string; filename: string; contentType: string; contentBase64: string }, now: Date = new Date()): Promise<KDone<KnowledgeSource>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  if (!input.title.trim() || !input.filename.trim() || input.contentBase64.length > Math.floor((MAX_FILE_BYTES * 4) / 3) + 16) return { ok: false, error: input.contentBase64.length > 0 ? "too_large" : "invalid" };
  if (mode === "mock") {
    // the test screens read plain text files only; the real API reads PDF and Word too
    if (!/^text\//.test(input.contentType) && !/\.(txt|md|csv)$/i.test(input.filename)) return { ok: false, error: "unsupported" };
    let text = "";
    try {
      text = Buffer.from(input.contentBase64, "base64").toString("utf8");
    } catch {
      return { ok: false, error: "unreadable" };
    }
    if (!text.trim()) return { ok: false, error: "no_text" };
    const s = await state();
    const mine = { id: input.sourceId, title: input.title.trim().slice(0, 120), kind: "file" as const, filename: input.filename.slice(0, 200), chars: text.length, createdAt: now.toISOString(), text: text.slice(0, 900), discarded: false };
    if (!(await keep({ ...s, sources: [...s.sources.slice(-2), mine] }))) return full();
    return { ok: true, value: sourceOf(mine, s.facts) };
  }
  return attempt(() => api.addFileSource(ctx.token, ctx.tenantId, { sourceId: input.sourceId, title: input.title.trim(), filename: input.filename, contentType: input.contentType, contentBase64: input.contentBase64 }));
}

/** The AI drafts facts from a source (nothing is stated by the assistant until the owner approves each one). */
export async function draft(ctx: Ctx, sourceId: string): Promise<KDone<Fact[]>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const src = s.sources.find((x) => x.id === sourceId);
    if (!src) return { ok: false, error: "not_available" };
    const keepFacts = s.facts.filter((f) => f.sourceId !== sourceId || f.status !== "draft");
    const made = draftFrom(src, new Set(keepFacts.map((f) => f.id))).slice(0, Math.max(0, 10 - keepFacts.length));
    if (made.length === 0) return { ok: false, error: "no_text" };
    const next = { sources: s.sources.map((x) => (x.id === sourceId ? { ...x, text: null } : x)), facts: [...keepFacts, ...made] };
    if (!(await keep(next))) return full();
    return { ok: true, value: made.map(factOf) };
  }
  return attempt(() => api.draftFacts(ctx.token, ctx.tenantId, sourceId));
}

export async function addManual(ctx: Ctx, input: { factId: string; kind: FactKind; text: string }): Promise<KDone<Fact>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  const text = cleanFactText(input.text);
  if (!text) return full();
  if (mode === "mock") {
    const s = await state();
    const mine = { id: input.factId, kind: input.kind, text: text.slice(0, 140), status: "draft" as const, edited: false, sourceId: null };
    if (!(await keep({ ...s, facts: [...s.facts.slice(-9), mine] }))) return full();
    return { ok: true, value: factOf(mine) };
  }
  return attempt(() => api.addFact(ctx.token, ctx.tenantId, { factId: input.factId, kind: input.kind, text }));
}

/** An edit puts the fact back to a draft: it must be approved again. */
export async function edit(ctx: Ctx, factId: string, input: { text: string; kind?: FactKind }): Promise<KDone<Fact>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  const text = cleanFactText(input.text);
  if (!text) return full();
  if (mode === "mock") {
    const s = await state();
    const f = s.facts.find((x) => x.id === factId);
    if (!f) return { ok: false, error: "not_available" };
    const next = { ...f, text: text.slice(0, 140), kind: input.kind ?? f.kind, status: "draft" as const, edited: true };
    if (!(await keep({ ...s, facts: s.facts.map((x) => (x.id === factId ? next : x)) }))) return full();
    return { ok: true, value: factOf(next) };
  }
  return attempt(() => api.editFact(ctx.token, ctx.tenantId, factId, input.kind ? { text, kind: input.kind } : { text }));
}

/** Approve or reject one fact. Approving a price needs the Owner with the second factor (the API asks; the test screens do not). */
export async function decide(ctx: Ctx, factId: string, decision: "approve" | "reject"): Promise<KDone<Fact>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const f = s.facts.find((x) => x.id === factId);
    if (!f) return { ok: false, error: "not_available" };
    const next = { ...f, status: decision === "approve" ? ("approved" as const) : ("rejected" as const) };
    if (!(await keep({ ...s, facts: s.facts.map((x) => (x.id === factId ? next : x)) }))) return full();
    return { ok: true, value: factOf(next) };
  }
  return attempt(() => api.decideFact(ctx.token, ctx.tenantId, factId, decision));
}

export async function discard(ctx: Ctx, sourceId: string): Promise<KDone<KnowledgeSource>> {
  const mode = leadsScreens();
  if (mode === "off") return off();
  if (mode === "mock") {
    const s = await state();
    const src = s.sources.find((x) => x.id === sourceId);
    if (!src) return { ok: false, error: "not_available" };
    const next = { sources: s.sources.map((x) => (x.id === sourceId ? { ...x, discarded: true, text: null } : x)), facts: s.facts.filter((f) => f.sourceId !== sourceId || f.status !== "draft") };
    if (!(await keep(next))) return full();
    return { ok: true, value: sourceOf({ ...src, discarded: true }, next.facts) };
  }
  return attempt(() => api.discardSource(ctx.token, ctx.tenantId, sourceId));
}

export { idFrom };
