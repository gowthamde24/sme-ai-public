import { createHash } from "node:crypto";

import { FACT_KINDS, PRICE_LOOKING, cleanFactText, type Fact, type FactKind, type KnowledgeSource } from "./knowledge";

/**
 * The FAKE knowledge base of the test screens (LEADS_SCREENS=mock): ONE small cookie. A source keeps only the first part of its text until its facts are drafted; the facts are the sentences of that text, each with a kind guessed
 * from its words (the real drafting is a model's, checked by the API). Nothing leaves the browser. Pure: the clock is a parameter.
 */
export const MOCK_COOKIE = "sme_knowledge_mock";
const KEEP_TEXT = 900;
const MAX_FACTS = 10;
const MAX_FACT_CHARS = 140;
export type MockSource = { id: string; title: string; kind: "paste" | "file"; filename: string | null; chars: number; createdAt: string; text: string | null; discarded: boolean };
export type MockFact = { id: string; kind: FactKind; text: string; status: Fact["status"]; edited: boolean; sourceId: string | null };
export type KnowledgeMock = { sources: MockSource[]; facts: MockFact[] };
export const EMPTY: KnowledgeMock = { sources: [], facts: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function parse(value: unknown): KnowledgeMock | null {
  if (!isObj(value)) return null;
  const sources: MockSource[] = [];
  for (const s of Array.isArray(value.sources) ? value.sources.slice(0, 3) : []) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.title !== "string" || s.title.length > 200 || (s.kind !== "paste" && s.kind !== "file") || typeof s.chars !== "number" || typeof s.createdAt !== "string") continue;
    sources.push({ id: s.id.slice(0, 40), title: s.title, kind: s.kind, filename: typeof s.filename === "string" ? s.filename.slice(0, 200) : null, chars: Math.max(0, Math.floor(s.chars)), createdAt: s.createdAt, text: typeof s.text === "string" ? s.text.slice(0, KEEP_TEXT) : null, discarded: s.discarded === true });
  }
  const facts: MockFact[] = [];
  for (const f of Array.isArray(value.facts) ? value.facts.slice(0, MAX_FACTS) : []) {
    if (!isObj(f) || typeof f.id !== "string" || !(FACT_KINDS as readonly string[]).includes(f.kind as string) || typeof f.text !== "string" || !["draft", "approved", "rejected"].includes(f.status as string)) continue;
    facts.push({ id: f.id.slice(0, 40), kind: f.kind as FactKind, text: f.text.slice(0, MAX_FACT_CHARS), status: f.status as Fact["status"], edited: f.edited === true, sourceId: typeof f.sourceId === "string" ? f.sourceId.slice(0, 40) : null });
  }
  return { sources, facts };
}

/** A UUID-shaped id from a seed (the same seed, the same id). */
export function idFrom(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The kind a sentence looks like (a guess; the owner decides). */
export function kindOf(text: string): FactKind {
  if (PRICE_LOOKING.test(text)) return "price";
  if (/\b(open|closed|hours|am|pm|monday|sunday|daily|timings?)\b/i.test(text)) return "hours";
  if (/\b(road|street|nagar|colony|near|sector|plot|floor|city|located|address)\b/i.test(text)) return "location";
  if (/\b(offer|discount|free|festival|% off)\b/i.test(text)) return "offer";
  if (/\b(refund|policy|warranty|cancel|terms)\b/i.test(text)) return "policy";
  if (/\b(phone|call us|whatsapp|email|contact)\b/i.test(text)) return "contact";
  return "product_service";
}

/** The facts a text would draft: its sentences, 12 to 140 characters, with no link or markup, at most ten. */
export function draftFrom(source: MockSource, ids: ReadonlySet<string>): MockFact[] {
  const out: MockFact[] = [];
  const parts = (source.text ?? "").split(/(?<=[.!?])\s+|\n+/);
  for (const p of parts) {
    const text = cleanFactText(p);
    if (!text || text.length < 12 || text.length > MAX_FACT_CHARS) continue;
    const id = idFrom(`${source.id}:${text}`);
    if (ids.has(id)) continue;
    out.push({ id, kind: kindOf(text), text, status: "draft", edited: false, sourceId: source.id });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

export const sourceOf = (s: MockSource, facts: readonly MockFact[]): KnowledgeSource => {
  const mine = facts.filter((f) => f.sourceId === s.id);
  return { id: s.id, title: s.title, kind: s.kind, filename: s.filename, contentType: null, chars: s.chars, status: s.discarded ? "discarded" : s.text === null && mine.length > 0 ? "drafted" : "read", createdAt: s.createdAt, facts: { draft: mine.filter((f) => f.status === "draft").length, approved: mine.filter((f) => f.status === "approved").length, rejected: mine.filter((f) => f.status === "rejected").length } };
};
export const factOf = (f: MockFact): Fact => ({ id: f.id, kind: f.kind, text: f.text, status: f.status, edited: f.edited, sourceId: f.sourceId, decidedAt: null, decidedByYou: f.status !== "draft" });
