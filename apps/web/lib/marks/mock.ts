import { createHash } from "node:crypto";

import { ISSUE_CODES, MAX_BYTES, type IssueCode, type MarksBatch, type MarksKind, type MarksLang, type MarksPreview, type MarksSent } from "./types";

/**
 * The FAKE marks send of the screen (job DP), only for MARKS_SCREENS=mock: it reads the file the person chose as text (CSV only), checks it by the contract's rules the way C1's API does (columns, phone numbers, numbers, formulas,
 * repeated lines), and "sends" nothing. Nothing of the file is kept: the preview is made in memory for the request, and what a send leaves is ONE small line of the log (counts and a time) in a cookie. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_marks_mock";
export class MockRefusal extends Error {
  constructor(readonly code: "marks_file_empty" | "marks_file_not_utf8" | "marks_file_too_large" | "marks_file_missing_column" | "marks_file_too_many_rows" | "marks_file_changed" | "marks_count_changed") {
    super(code);
  }
}

const REQUIRED: Record<MarksKind, readonly string[]> = { marks: ["phone", "student", "subject", "marks", "out_of"], report_ready: ["phone", "student"] };
const norm = (h: string): string => h.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
const ALIAS: Record<string, string> = { mobile: "phone", parent_phone: "phone", name: "student", out_of: "out_of", total: "out_of", exam: "term" };

function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === "," || ch === "\t") && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const EXAMPLE: Record<MarksKind, string> = {
  marks: "Test message: {student} scored {marks} out of {out_of} in {subject} ({term}). This message is made from fixed words.",
  report_ready: "Test message: the report card of {student} for {term} is ready. This message is made from fixed words.",
};

export function mockPreview(file: ArrayBuffer, kind: MarksKind, language: MarksLang, term: string): MarksPreview {
  if (file.byteLength === 0) throw new MockRefusal("marks_file_empty");
  if (file.byteLength > MAX_BYTES) throw new MockRefusal("marks_file_too_large");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    throw new MockRefusal("marks_file_not_utf8");
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new MockRefusal("marks_file_empty");
  if (lines.length - 1 > 5000) throw new MockRefusal("marks_file_too_many_rows");
  const head = cells(lines[0]).map((h) => ALIAS[norm(h)] ?? norm(h));
  const need = [...REQUIRED[kind], ...(term ? [] : ["term"])];
  if (need.some((c) => !head.includes(c))) throw new MockRefusal("marks_file_missing_column");
  const at = (row: string[], col: string): string => row[head.indexOf(col)] ?? "";
  const issues: { line: number; code: IssueCode; field: string }[] = [];
  const seen = new Set<string>();
  let willSend = 0, blocked = 0, unknownGuardian = 0, invalid = 0, duplicates = 0, first: string[] | null = null;
  const byTemplate: Record<string, number> = {};
  lines.slice(1).forEach((l, i) => {
    const row = cells(l);
    const line = i + 2;
    const flag = (code: IssueCode, field: string) => issues.push({ line, code, field });
    if (row.some((c) => c.startsWith("="))) return void (invalid++, flag("formula_cell", head.find((_, j) => (row[j] ?? "").startsWith("=")) ?? "phone"));
    const phone = at(row, "phone").replace(/[\s-]/g, "");
    if (!/^\+?\d{10,15}$/.test(phone)) return void (invalid++, flag("bad_phone", "phone"));
    if (kind === "marks") {
      const marks = Number(at(row, "marks")), outOf = Number(at(row, "out_of"));
      if (!Number.isFinite(marks) || !Number.isFinite(outOf) || outOf <= 0 || marks < 0 || marks > outOf) return void (invalid++, flag("bad_value", "marks"));
    }
    const lang = at(row, "language") || language;
    if (!["en", "te", "hi", "kn"].includes(lang)) return void (invalid++, flag("bad_language", "language"));
    const key = [phone, at(row, "student"), at(row, "subject"), at(row, "term")].join("|");
    if (seen.has(key)) return void (duplicates++, flag("duplicate_row", "phone"));
    seen.add(key);
    if (phone.endsWith("0000")) return void (unknownGuardian++, flag("unknown_guardian", "phone"));
    if (phone.endsWith("9999")) return void (blocked++, flag("blocked_guardian", "phone"));
    willSend++;
    byTemplate[`${kind}.${lang}`] = (byTemplate[`${kind}.${lang}`] ?? 0) + 1;
    first ??= row;
  });
  const sample = first as string[] | null;
  const example = sample ? EXAMPLE[kind].replace("{student}", at(sample, "student")).replace("{marks}", at(sample, "marks")).replace("{out_of}", at(sample, "out_of")).replace("{subject}", at(sample, "subject")).replace("{term}", at(sample, "term") || term) : null;
  const shown = issues.slice(0, 50);
  void ISSUE_CODES;
  return { rows: lines.length - 1, willSend, blocked, unknownGuardian, invalid, duplicates, byTemplate, fileSha256: createHash("sha256").update(Buffer.from(file)).digest("hex"), issues: shown, issuesTruncated: issues.length > shown.length, exampleText: example };
}

/** The "send" of the fake: the file must be the one that was previewed (its SHA-256 and count), then it says what a real send would have done. Nothing leaves. */
export function mockSend(file: ArrayBuffer, kind: MarksKind, language: MarksLang, term: string, batchId: string, sha256: string, count: number): MarksSent {
  const p = mockPreview(file, kind, language, term);
  if (p.fileSha256 !== sha256) throw new MockRefusal("marks_file_changed");
  if (p.willSend !== count) throw new MockRefusal("marks_count_changed");
  return { sent: p.willSend, failed: 0, blocked: p.blocked, alreadyHandled: 0, skipped: p.invalid + p.unknownGuardian + p.duplicates, batchId };
}

const CAP = 5;
export function parseLog(raw: string | undefined): MarksBatch[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.slice(0, CAP).flatMap((b) => (Array.isArray(b) && typeof b[0] === "string" && b[0].length <= 64 && typeof b[1] === "string" && !Number.isNaN(Date.parse(b[1])) && [2, 3, 4].every((i) => Number.isInteger(b[i]) && b[i] >= 0) ? [{ batchId: b[0], at: b[1], sent: b[2], failed: b[3], blocked: b[4] }] : []));
  } catch {
    return [];
  }
}
export const encodeLog = (log: readonly MarksBatch[]): string => JSON.stringify(log.slice(0, CAP).map((b) => [b.batchId, b.at, b.sent, b.failed, b.blocked]));
