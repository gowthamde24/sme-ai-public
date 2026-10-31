/**
 * Lead imports and the sheets kept in sync (night 4, Lead Desk, items 3; contract-lead-sources.md): the words of the wire, the checks of what the browser sends, and the answers the screens draw. The shapes mirror the API's
 * generated models (`services/ai-api/app/lead_sources/models.py`): a body that is not exactly the contract is refused here, before it leaves the server. Pure (no server import): the client components import the types only.
 */
export const SOURCE_TAGS = ["indiamart", "justdial", "99acres", "magicbricks", "housing", "meta_lead_ads", "website_form", "webhook", "email_forward", "excel_upload", "google_sheet", "pasted_list", "vcard"] as const;
export type SourceTag = (typeof SOURCE_TAGS)[number];
export const PORTALS = ["indiamart", "justdial", "99acres", "magicbricks", "housing"] as const;
export type Portal = (typeof PORTALS)[number];
export const READ_KINDS = ["file", "paste", "vcard", "sheet"] as const;
export type ReadKind = (typeof READ_KINDS)[number];
export const DEFAULT_TAG: Record<ReadKind, SourceTag> = { file: "excel_upload", paste: "pasted_list", vcard: "vcard", sheet: "google_sheet" };
/** The tags an owner may pick for a bulk import: the kind's own, or the portal the list came from. */
export const importTagsFor = (kind: ReadKind): readonly SourceTag[] => [DEFAULT_TAG[kind], ...PORTALS];
export const FIELD_KEYS = ["name", "phone", "email", "city", "message", "external_id", "received_at", "source_note"] as const;
export type Field = (typeof FIELD_KEYS)[number];
export const CONFIDENCES = ["exact", "partial", "weak", "ai", "none"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const BASES = ["explicit_consent", "legitimate_use", "contractual"] as const;
export type Basis = (typeof BASES)[number];
/** Why a file was refused (422 sheet_refused, `reason`). */
export const REFUSED_REASONS = ["empty", "too_large", "not_utf8", "malformed_csv", "too_many_rows", "too_many_columns", "no_header", "not_xlsx", "encrypted", "unsafe_xml", "unreadable"] as const;
export type RefusedReason = (typeof REFUSED_REASONS)[number];
export const PROBLEM_REASONS = ["invalid_number", "no_contact_way", "duplicate_in_file", "already_imported", "real_data_gate", "opted_out", "row_refused"] as const;

export const MAX_FILE_BYTES = 3_000_000;
/** The longest base64 text of a file of MAX_FILE_BYTES (the API's own limit). */
export const MAX_BASE64_CHARS = Math.floor((MAX_FILE_BYTES * 4) / 3) + 16;
export const MAX_TEXT_CHARS = 600_000;
export const MAX_ROWS = 5000;
export const MAX_COST_PAISE = 10_000_000;

export type Mapping = Partial<Record<Field, number>>;
export type Consent = { confirmed: true; list_name: string; purpose: string; basis: Basis; how_collected: string };

/** What the three calls (read, preview, import) all carry: the source content, sent again each time (nothing is kept between them). */
export type ReadBody = { kind: ReadKind; filename: string | null; content_base64: string | null; text: string | null; sheet_url: string | null; use_ai: boolean };
export type PreviewBody = ReadBody & { mapping: Mapping | null; source: SourceTag | null; consent_confirmed: boolean };
export type ImportBody = PreviewBody & { import_id: string; consent: Consent | null; cost_per_lead_paise: number | null };
export type SheetLinkBody = { link_id: string; sheet_url: string; mapping: Mapping; consent: Consent | null; cost_per_lead_paise: number | null };

export type Column = { index: number; header: string; samples: string[]; field: Field | null; confidence: Confidence };
export type FieldInfo = { field: Field; label: string; required: boolean };
export type ReadResult = { kind: ReadKind; rows: number; columns: Column[]; fields: FieldInfo[]; mapping: Mapping | null; mapped_by: "rules" | "rules+ai" | "none"; needs_confirmation: boolean; warnings: string[] };
export type Counts = { ready: number; duplicates_merged: number; duplicates_in_file: number; already_imported: number; invalid: number; dnd: number; no_consent: number; blocked: number };
export type Problem = { row: number; reason: string };
export type Estimate = { messages: number; call_minutes: number; cost_paise: number | null; basis: "estimate" };
export type PreviewResult = { rows_read: number; source: string; counts: Counts; estimate: Estimate; problems: Problem[]; dnd_lookup: "checked" | "not_configured" };
export type ImportResult = { import_id: string; status: "done"; source: string; consent_id: string | null; counts: Counts; problems: Problem[]; created_at: string };
export type ImportItem = { import_id: string; kind: string; source: string; rows_read: number; counts: Counts; problems: Problem[]; consent_id: string | null; by: string | null; created_at: string };
export type SheetMode = { mode: "anyone_with_link" | "published_csv" | "service_account"; available: boolean; service_account_email: string | null };
export type SheetLink = { id: string; status: "active" | "paused" | "needs_attention"; source: string; last_synced_at: string | null; last_row_count: number | null; last_result: Record<string, number> | null; last_error: "sheet_not_public" | "columns_changed" | "unreachable" | "too_large" | null; created_at: string; next_sync_at: string | null };
export type SheetAccess = { modes: SheetMode[] };

/** Why a step did not work, as a closed word the screen has a sentence for (the API's text is never shown). */
export const FAILURES = [
  "not_available", "forbidden", "read_only", "mfa", "invalid", "too_large", "consent_owner_only", "sheet_refused", "sheet_not_public", "sheet_link_invalid", "sheet_unreachable", "mapping_required_missing", "import_id_used", "real_data_gate",
  "rate_limited", "csv_only", "connector_not_available", "too_many", "down",
] as const;
export type FailureCode = (typeof FAILURES)[number];
export type Failure = { ok: false; error: FailureCode; reason?: RefusedReason };
export type Out<T> = { ok: true; data: T } | Failure;

// ------------------------------------------------------------------------------------------------------------------ checks of what the browser sends
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const oneLineOf = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s.length >= 1 && s.length <= max ? s : null;
};

/** The Google Sheets link: https, docs.google.com, under /spreadsheets/. Anything else is not sent anywhere. */
export function validSheetUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets/") ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseMapping(v: unknown): Mapping | null | "bad" {
  if (v === null || v === undefined) return null;
  if (!isRec(v)) return "bad";
  const out: Mapping = {};
  for (const [k, n] of Object.entries(v)) {
    if (!(FIELD_KEYS as readonly string[]).includes(k) || typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 999) return "bad";
    out[k as Field] = n;
  }
  return out;
}
/** A phone or an e-mail must be mapped (the API's rule, said before the call). */
export const mappingHasContact = (m: Mapping | null): boolean => m !== null && (m.phone !== undefined || m.email !== undefined);

export function parseConsent(v: unknown): Consent | null | "bad" {
  if (v === null || v === undefined) return null;
  if (!isRec(v) || v.confirmed !== true) return "bad";
  const list_name = oneLineOf(v.list_name, 120);
  const purpose = oneLineOf(v.purpose, 300);
  const how_collected = oneLineOf(v.how_collected, 300);
  if (!list_name || !purpose || !how_collected || !(BASES as readonly unknown[]).includes(v.basis)) return "bad";
  return { confirmed: true, list_name, purpose, basis: v.basis as Basis, how_collected };
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: "invalid" | "too_large" | "sheet_link_invalid" | "mapping_required_missing" };
const no = (error: "invalid" | "too_large" | "sheet_link_invalid" | "mapping_required_missing" = "invalid"): { ok: false; error: typeof error } => ({ ok: false, error });

export function checkReadBody(v: unknown): Checked<ReadBody> {
  if (!isRec(v) || !(READ_KINDS as readonly unknown[]).includes(v.kind)) return no();
  const kind = v.kind as ReadKind;
  const filename = v.filename === null || v.filename === undefined ? null : oneLineOf(v.filename, 200);
  if (v.filename !== null && v.filename !== undefined && filename === null) return no();
  let content: string | null = null;
  let text: string | null = null;
  let sheet: string | null = null;
  if (v.content_base64 !== null && v.content_base64 !== undefined) {
    if (typeof v.content_base64 !== "string") return no();
    if (v.content_base64.length > MAX_BASE64_CHARS) return no("too_large");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v.content_base64)) return no();
    content = v.content_base64;
  }
  if (v.text !== null && v.text !== undefined) {
    if (typeof v.text !== "string") return no();
    if (v.text.length > MAX_TEXT_CHARS) return no("too_large");
    text = v.text;
  }
  if (v.sheet_url !== null && v.sheet_url !== undefined) {
    sheet = validSheetUrl(v.sheet_url);
    if (sheet === null) return no("sheet_link_invalid");
  }
  if (kind === "file" && !content) return no();
  if (kind === "paste" && !(text && text.trim())) return no();
  if (kind === "vcard" && !(content || (text && text.trim()))) return no();
  if (kind === "sheet" && !sheet) return no("sheet_link_invalid");
  // only the part the kind uses is kept: nothing else is sent on
  return { ok: true, value: { kind, filename: kind === "file" || kind === "vcard" ? filename : null, content_base64: kind === "file" || kind === "vcard" ? content : null, text: kind === "paste" || kind === "vcard" ? text : null, sheet_url: kind === "sheet" ? sheet : null, use_ai: v.use_ai === false ? false : true } };
}

export function checkPreviewBody(v: unknown): Checked<PreviewBody> {
  const base = checkReadBody(v);
  if (!base.ok || !isRec(v)) return base.ok ? no() : base;
  const tabular = base.value.kind === "file" || base.value.kind === "sheet";
  const mapping = parseMapping(v.mapping);
  if (mapping === "bad") return no();
  if (tabular && mapping !== null && !mappingHasContact(mapping)) return no("mapping_required_missing");
  const source = v.source === null || v.source === undefined ? null : v.source;
  if (source !== null && !importTagsFor(base.value.kind).includes(source as SourceTag)) return no();
  if (v.consent_confirmed !== undefined && typeof v.consent_confirmed !== "boolean") return no();
  return { ok: true, value: { ...base.value, mapping: tabular ? mapping : null, source: source as SourceTag | null, consent_confirmed: v.consent_confirmed === true } };
}

export function checkImportBody(v: unknown): Checked<ImportBody> {
  const base = checkPreviewBody(v);
  if (!base.ok || !isRec(v)) return base.ok ? no() : base;
  if (!isUuid(v.import_id)) return no();
  const consent = parseConsent(v.consent);
  if (consent === "bad") return no();
  const cost = v.cost_per_lead_paise === null || v.cost_per_lead_paise === undefined ? null : v.cost_per_lead_paise;
  if (cost !== null && (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0 || cost > MAX_COST_PAISE)) return no();
  return { ok: true, value: { ...base.value, consent_confirmed: consent !== null, import_id: v.import_id, consent, cost_per_lead_paise: cost } };
}

export function checkSheetLinkBody(v: unknown): Checked<SheetLinkBody> {
  if (!isRec(v) || !isUuid(v.link_id)) return no();
  const url = validSheetUrl(v.sheet_url);
  if (!url) return no("sheet_link_invalid");
  const mapping = parseMapping(v.mapping);
  if (mapping === "bad" || mapping === null) return no();
  if (!mappingHasContact(mapping)) return no("mapping_required_missing");
  const consent = parseConsent(v.consent);
  if (consent === "bad") return no();
  const cost = v.cost_per_lead_paise === null || v.cost_per_lead_paise === undefined ? null : v.cost_per_lead_paise;
  if (cost !== null && (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0 || cost > MAX_COST_PAISE)) return no();
  return { ok: true, value: { link_id: v.link_id, sheet_url: url, mapping, consent, cost_per_lead_paise: cost } };
}

/** "12" or "12.50" rupees -> paise, or null when it is not an amount (at most two decimals, at most 100,000 rupees). Empty text is `undefined`: no cost given. */
export function rupeesToPaise(text: string): number | null | undefined {
  const s = text.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (s === "") return undefined;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise <= MAX_COST_PAISE ? paise : null;
}
