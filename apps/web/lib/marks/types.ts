/**
 * Marks and report-card messages to parents (job DP; C1's contract-marks-messages.md). OWNER DECISION: the platform never stores a child's marks. A school uploads a file for ONE send; the API reads it in memory to make a preview,
 * and the screen sends the SAME file again with the preview's SHA-256 and count when the Owner approves; only a send log stays (no marks, no child's name). These are the shapes the screen reads; every answer is checked.
 */
export const KINDS = ["marks", "report_ready"] as const;
export type MarksKind = (typeof KINDS)[number];
export const LANGS = ["en", "te", "hi", "kn"] as const;
export type MarksLang = (typeof LANGS)[number];
export const ISSUE_CODES = ["bad_phone", "bad_value", "bad_language", "formula_cell", "duplicate_row", "unknown_guardian", "blocked_guardian"] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
export const MAX_BYTES = 3 * 1024 * 1024;

export type MarksIssue = { line: number; code: IssueCode; /** The column the problem is in (never a cell), or null when it is about the whole line. */ field: string | null };
export type MarksPreview = {
  rows: number;
  willSend: number;
  blocked: number;
  unknownGuardian: number;
  invalid: number;
  duplicates: number;
  byTemplate: Record<string, number>;
  fileSha256: string;
  issues: readonly MarksIssue[];
  issuesTruncated: boolean;
  /** The first ready message, as the parent will read it (made of fixed words and the values of one line: shown to the Owner only, never kept). */
  exampleText: string | null;
};
export type MarksSent = { sent: number; failed: number; blocked: number; alreadyHandled: number; skipped: number; batchId: string };
export type MarksBatch = { batchId: string; at: string | null; sent: number; failed: number; blocked: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);

export function parsePreview(json: unknown): MarksPreview | null {
  if (!isRecord(json)) return null;
  const rows = count(json.rows), willSend = count(json.will_send), blocked = count(json.blocked), unknownGuardian = count(json.unknown_guardian), invalid = count(json.invalid), duplicates = count(json.duplicates);
  if (rows === null || willSend === null || blocked === null || unknownGuardian === null || invalid === null || duplicates === null) return null;
  if (typeof json.file_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(json.file_sha256)) return null;
  if (!isRecord(json.by_template) || !Array.isArray(json.issues) || json.issues.length > 50) return null;
  const byTemplate: Record<string, number> = {};
  for (const [k, v] of Object.entries(json.by_template)) {
    const n = count(v);
    if (!/^[a-z_]{1,20}\.[a-z]{2}$/.test(k) || n === null) return null;
    byTemplate[k] = n;
  }
  const issues: MarksIssue[] = [];
  for (const i of json.issues) {
    if (!isRecord(i) || count(i.line) === null || !(ISSUE_CODES as readonly unknown[]).includes(i.code) || !(i.field === null || i.field === undefined || (typeof i.field === "string" && /^[a-z_ ]{0,40}$/i.test(i.field)))) return null;
    issues.push({ line: i.line as number, code: i.code as IssueCode, field: typeof i.field === "string" && i.field !== "" ? i.field : null });
  }
  const example = json.example_text;
  if (example !== null && example !== undefined && (typeof example !== "string" || example.length > 1500)) return null;
  return { rows, willSend, blocked, unknownGuardian, invalid, duplicates, byTemplate, fileSha256: json.file_sha256, issues, issuesTruncated: json.issues_truncated === true, exampleText: typeof example === "string" ? example : null };
}

export function parseSent(json: unknown): MarksSent | null {
  if (!isRecord(json)) return null;
  const sent = count(json.sent), failed = count(json.failed), blocked = count(json.blocked), alreadyHandled = count(json.already_handled), skipped = count(json.skipped);
  if (sent === null || failed === null || blocked === null || alreadyHandled === null || skipped === null || typeof json.batch_id !== "string" || json.batch_id.length > 64) return null;
  return { sent, failed, blocked, alreadyHandled, skipped, batchId: json.batch_id };
}

/** The send log: one line per batch, newest first. Anything that is not a batch of the log's shape is left out (the contract's JSON for it comes with the API). */
export function parseBatches(json: unknown): MarksBatch[] {
  const list = isRecord(json) && Array.isArray(json.items) ? json.items : Array.isArray(json) ? json : [];
  const out: MarksBatch[] = [];
  for (const b of list.slice(0, 50)) {
    if (!isRecord(b)) continue;
    const id = b.batch_id ?? b.id;
    const at = b.created_at ?? b.at ?? b.started_at;
    const sent = count(b.sent), failed = count(b.failed), blocked = count(b.blocked);
    if (typeof id !== "string" || id.length > 64 || sent === null || failed === null || blocked === null) continue;
    out.push({ batchId: id, at: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null, sent, failed, blocked });
  }
  return out;
}

export const isKind = (v: unknown): v is MarksKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const isLang = (v: unknown): v is MarksLang => typeof v === "string" && (LANGS as readonly string[]).includes(v);
