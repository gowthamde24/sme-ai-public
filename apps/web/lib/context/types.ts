/**
 * "About my business" (job context-and-easy-sources part A, contract-context-sources.md, 28 Oct): the owner's own notes that the assistant uses in chats, calls, Ask / the circle and drafts, like briefing a new employee. Per workspace, versioned, written by the
 * Owner and Admins. These are the shapes the screen reads; every answer of the API is checked before it is used. A fact from the notes may be stated by the assistant ("from your notes"); anything not in the records or the notes is never invented.
 */
export const NOTES_MAX = 20_000;
export const SECTIONS = ["prices", "delivery", "timings", "payment", "always_say", "never_say", "discounts", "handover", "tone", "faq", "products", "other"] as const;
export type Section = (typeof SECTIONS)[number];
export const WARNINGS = ["cells_cut", "illegible_part", "looks_like_personal_data"] as const;
export type Warning = (typeof WARNINGS)[number];
export const HANDOVER_REASONS = ["asked_for_a_person", "asked_about_money", "complaint", "unsure"] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

export type Prompt = { key: string; label: string; hint: string };
export type ContextState = { notes: string; version: number; updatedAt: string | null; updatedBy: { id: string; name: string } | null; prompts: Prompt[]; usedBy: string[] };
export type VersionItem = { version: number; updatedAt: string; updatedBy: string | null; size: number; change: string };
export type Understood = { previewId: string; understood: { section: Section; text: string }[]; notesMarkdown: string; source: { kind: string; filename: string | null }; warnings: Warning[]; expiresAt: string };
export type TestAnswer = { answer: string; language: string; used: { from: "notes" | "facts"; snippet: string }[]; wouldHandOver: boolean; reason: HandoverReason | null };

/** The closed words a refusal becomes; the API's own English is never passed on (the screen has a sentence for each). */
export type ContextError = "changed" | "expired" | "schools_fees" | "schools_marks" | "schools_dues" | "schools_children" | "refused" | "unreadable" | "toolarge" | "busy" | "forbidden" | "slow" | "down";
export type Done<T> = { ok: true; data: T } | { ok: false; error: ContextError };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

export function parseContext(json: unknown): ContextState | null {
  if (!isRec(json)) return null;
  const notes = str(json.notes, NOTES_MAX + 1000);
  if (notes === null || typeof json.version !== "number" || !Number.isInteger(json.version) || json.version < 0) return null;
  const by = isRec(json.updated_by) && typeof json.updated_by.id === "string" ? { id: json.updated_by.id.slice(0, 64), name: String(json.updated_by.name ?? "").slice(0, 100) } : null;
  const prompts = Array.isArray(json.prompts) ? json.prompts.filter(isRec).slice(0, 20).map((p) => ({ key: String(p.key ?? "").slice(0, 40), label: String(p.label ?? "").slice(0, 100), hint: String(p.hint ?? "").slice(0, 300) })).filter((p) => p.key !== "" && p.label !== "") : [];
  return { notes, version: json.version, updatedAt: typeof json.updated_at === "string" ? json.updated_at : null, updatedBy: by, prompts, usedBy: Array.isArray(json.used_by) ? json.used_by.filter((x): x is string => typeof x === "string").slice(0, 8) : [] };
}

export function parseVersions(json: unknown): VersionItem[] | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  return json.items.filter(isRec).slice(0, 50).map((x) => ({ version: Number(x.version), updatedAt: String(x.updated_at ?? ""), updatedBy: isRec(x.updated_by) ? String(x.updated_by.name ?? "") : null, size: Number(x.size ?? 0), change: String(x.change ?? "").slice(0, 100) })).filter((x) => Number.isInteger(x.version));
}

export function parseUnderstood(json: unknown): Understood | null {
  if (!isRec(json) || typeof json.preview_id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(json.preview_id)) return null;
  const notes = str(json.notes_markdown, NOTES_MAX + 1000);
  if (notes === null) return null;
  const understood = Array.isArray(json.understood) ? json.understood.filter(isRec).slice(0, 40).map((u) => ({ section: ((SECTIONS as readonly unknown[]).includes(u.section) ? u.section : "other") as Section, text: String(u.text ?? "").slice(0, 4000) })) : [];
  const src = isRec(json.source) ? json.source : {};
  return { previewId: json.preview_id, understood, notesMarkdown: notes, source: { kind: String(src.kind ?? "").slice(0, 20), filename: typeof src.filename === "string" ? src.filename.slice(0, 200) : null }, warnings: Array.isArray(json.warnings) ? json.warnings.filter((w): w is Warning => (WARNINGS as readonly unknown[]).includes(w)) : [], expiresAt: String(json.expires_at ?? "") };
}

export function parseTest(json: unknown): TestAnswer | null {
  if (!isRec(json) || typeof json.answer !== "string" || json.answer.length > 4000) return null;
  return {
    answer: json.answer,
    language: String(json.language ?? "").slice(0, 8),
    used: Array.isArray(json.used) ? json.used.filter(isRec).slice(0, 10).map((u) => ({ from: u.from === "facts" ? ("facts" as const) : ("notes" as const), snippet: String(u.snippet ?? "").slice(0, 400) })) : [],
    wouldHandOver: json.would_hand_over === true,
    reason: (HANDOVER_REASONS as readonly unknown[]).includes(json.reason) ? (json.reason as HandoverReason) : null,
  };
}

/** What the screen may send as a file: the kinds the API reads, up to 3 MB. */
export const FILE_ACCEPT = ".pdf,.xlsx,.csv,.docx,.txt,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const FILE_MAX_BYTES = 3 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 120;
export const UNDERSTAND_KINDS = ["paste", "file", "voice"] as const;
export type UnderstandKind = (typeof UNDERSTAND_KINDS)[number];
