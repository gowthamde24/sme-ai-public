import { bad, bool, int, list, oneOf, optIso, optStr, rec, str } from "@/lib/api/shape";

/**
 * The knowledge base of Lead Desk (night 4, part A1; contract-leads-pack.md section 3): the facts about the business that the assistant may STATE. The owner pastes text (a website, an Instagram caption) or uploads a brochure, a price
 * list or an FAQ; the AI drafts facts; the owner approves, edits or rejects each one. The assistant states only APPROVED facts, and a price only if it is an approved fact of the kind `price` (approving a price needs the Owner with the
 * second factor). Pure types, parsing and the checks a form makes before it asks the API (the API checks again).
 */
export const FACT_KINDS = ["price", "offer", "product_service", "location", "hours", "policy", "faq", "contact", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type FactStatus = "draft" | "approved" | "rejected";
export type SourceStatus = "read" | "drafted" | "discarded";
export const MAX_PASTE_CHARS = 60_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** File types a brochure may be (the API reads text out of them; pictures and scanned files need a reader that may not be switched on). */
export const FILE_TYPES: Readonly<Record<string, string>> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/plain", csv: "text/csv" };

export type KnowledgeSource = { id: string; title: string; kind: "paste" | "file"; filename: string | null; contentType: string | null; chars: number; status: SourceStatus; createdAt: string; facts: { draft: number; approved: number; rejected: number } };
export type Fact = { id: string; kind: FactKind; text: string; status: FactStatus; edited: boolean; sourceId: string | null; decidedAt: string | null; decidedByYou: boolean };
export type KnowledgeRefusal = "mfa" | "read_only" | "too_large" | "unsupported" | "unreadable" | "no_text" | "reader" | "invalid" | "forbidden" | "not_available" | "down";
export type KDone<T> = { ok: true; value: T } | { ok: false; error: KnowledgeRefusal };

/** What looks like a price (the database's own rule, the same words): such a text can only be a fact of the kind `price`. */
export const PRICE_LOOKING = /(₹|\brs\.?\s?[0-9]|[0-9]\s?(rupees|lakh|crore)\b|\brupees\b)/i;
export const LINK = /(https?:\/\/|www\.)/i;

/** A fact's text as a form may send it: 3 to 500 characters, no link, no markup; null when it is not. */
export function cleanFactText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().replace(/\s+/g, " ");
  return t.length >= 3 && t.length <= 500 && !LINK.test(t) && !/[<>{}\u0000-\u001f\u007f]/.test(t) ? t : null;
}

/** A price must be said as a price, and a price fact needs the Owner's second factor. */
export const needsSecondFactor = (kind: FactKind, text: string): boolean => kind === "price" || PRICE_LOOKING.test(text);

export function parseSource(json: unknown): KnowledgeSource {
  const x = rec(json, "source");
  const f = rec(x.facts ?? { draft: 0, approved: 0, rejected: 0 }, "facts");
  return {
    id: str(x.id, "id", 80),
    title: str(x.title, "title", 200),
    kind: oneOf(x.kind, ["paste", "file"] as const, "kind"),
    filename: optStr(x.filename, "filename", 200),
    contentType: optStr(x.content_type, "content_type", 100),
    chars: int(x.chars, "chars", 0, 10_000_000),
    status: oneOf(x.status, ["read", "drafted", "discarded"] as const, "status"),
    createdAt: optIso(x.created_at, "created_at") ?? "",
    facts: { draft: int(f.draft, "draft"), approved: int(f.approved, "approved"), rejected: int(f.rejected, "rejected") },
  };
}

export function parseSources(json: unknown): KnowledgeSource[] {
  return list(rec(json, "sources").sources, "sources", 200).map(parseSource);
}

export function parseFact(json: unknown): Fact {
  const x = rec(json, "fact");
  return {
    id: str(x.id, "id", 80),
    kind: oneOf(x.kind, FACT_KINDS, "kind"),
    text: str(x.text, "text", 600),
    status: oneOf(x.status, ["draft", "approved", "rejected"] as const, "status"),
    edited: x.edited === true,
    sourceId: optStr(x.source_id, "source_id", 80),
    decidedAt: optIso(x.decided_at, "decided_at"),
    decidedByYou: bool(x.decided_by_you ?? false, "decided_by_you"),
  };
}

export function parseFacts(json: unknown): { facts: Fact[]; nextCursor: string | null } {
  const x = rec(json, "facts");
  return { facts: list(x.facts, "facts", 500).map(parseFact), nextCursor: optStr(x.next_cursor, "next_cursor", 300) };
}

export const parseDraft = (json: unknown): Fact[] => list(rec(json, "draft").facts, "facts", 100).map(parseFact);
export const never = (what: string): never => bad(what);
