import { describe, expect, it } from "vitest";

import { fingerprint, mockPreview, mockRead, normalizeIndianMobile, onFakeDnd, splitCsv, suggestColumns } from "./mock";
import { DEFAULT_TAG, type PreviewBody, type ReadBody } from "./types";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const file = (csv: string, filename = "leads.csv"): ReadBody => ({ kind: "file", filename, content_base64: b64(csv), text: null, sheet_url: null, use_ai: true });
const paste = (text: string): ReadBody => ({ kind: "paste", filename: null, content_base64: null, text, sheet_url: null, use_ai: true });
const preview = (body: ReadBody, extra: Partial<PreviewBody> = {}): PreviewBody => ({ ...body, mapping: null, source: null, consent_confirmed: false, ...extra });

describe("test mode: the Indian mobile check", () => {
  it("takes 10 digits starting 6 to 9, with +91, 91, 0 and separators", () => {
    expect(normalizeIndianMobile("9000000001")).toBe("+919000000001");
    expect(normalizeIndianMobile("+91 90000-00001")).toBe("+919000000001");
    expect(normalizeIndianMobile("919000000001")).toBe("+919000000001");
    expect(normalizeIndianMobile("09000000001")).toBe("+919000000001");
    expect(normalizeIndianMobile("(90000) 00001")).toBe("+919000000001");
    expect(normalizeIndianMobile("9000000001.0")).toBe("+919000000001");
  });
  it("refuses short, long, landline-looking and foreign numbers", () => {
    for (const bad of ["12345", "5000000001", "90000000", "90000000011", "+44 7000000001", "abcdefghij", ""]) expect(normalizeIndianMobile(bad), bad).toBeNull();
  });
  it("the fake Do-Not-Disturb list is the numbers ending in 99", () => {
    expect(onFakeDnd("+919000000099")).toBe(true);
    expect(onFakeDnd("+919000000001")).toBe(false);
  });
});

describe("test mode: reading a list", () => {
  it("reads a CSV and suggests the columns with a confidence", () => {
    const out = mockRead(file("Name,Mobile,City\nRavi,9000000001,Guntur\nAnitha,9000000002,Nellore\n"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.read.rows).toBe(2);
    expect(out.read.mapping).toEqual({ name: 0, phone: 1, city: 2 });
    expect(out.read.columns.map((c) => c.confidence)).toEqual(["exact", "exact", "exact"]);
    expect(out.read.columns[1].samples).toEqual(["9000000001", "9000000002"]);
    expect(out.read.needs_confirmation).toBe(true);
  });
  it("understands headers in Telugu and by the shape of the values, and leaves the rest unmapped", () => {
    const s = suggestColumns(["పేరు", "x", "y", "z"], [["Ravi", "9000000001", "a@b.co", "hello"]]);
    expect(s.mapping).toEqual({ name: 0, phone: 1, email: 2 });
    expect(s.columns[1].confidence).toBe("weak");
    expect(s.columns[3].field).toBeNull();
  });
  it("reads a tab-separated file and quoted cells", () => {
    expect(splitCsv('a\tb\n"x, y"\tz\n')).toEqual([["a", "b"], ["x, y", "z"]]);
    expect(splitCsv('a;b\n1;"he said ""hi"""\n')).toEqual([["a", "b"], ["1", 'he said "hi"']]);
  });
  it("a pasted list and a vCard need no column matching", () => {
    const p = mockRead(paste("Ravi, 9000000001\n9000000002\n"));
    expect(p.ok && p.read.columns).toEqual([]);
    expect(p.ok && p.read.mapping).toBeNull();
    expect(p.ok && p.read.needs_confirmation).toBe(false);
    expect(p.ok && p.read.rows).toBe(2);
    const v = mockRead({ kind: "vcard", filename: "c.vcf", content_base64: null, text: "BEGIN:VCARD\nFN:Ravi\nTEL;TYPE=CELL:9000000001\nEND:VCARD\nBEGIN:VCARD\nFN:Anitha\nTEL:+91 90000 00002\nEND:VCARD\n", sheet_url: null, use_ai: true });
    expect(v.ok && v.read.rows).toBe(2);
  });
  it("an Excel file cannot be read in test mode, and says so", () => {
    expect(mockRead({ ...file("x"), filename: "leads.xlsx" })).toEqual({ ok: false, error: "csv_only" });
    const zip = Buffer.from([0x50, 0x4b, 3, 4, 0, 0]).toString("base64");
    expect(mockRead({ ...file("x"), content_base64: zip })).toEqual({ ok: false, error: "csv_only" });
  });
  it("refuses an empty file, a file that is not UTF-8 and one with too many rows or columns, with the API's reasons", () => {
    expect(mockRead(file(""))).toEqual({ ok: false, error: "sheet_refused", reason: "empty" });
    expect(mockRead({ ...file("x"), content_base64: Buffer.from([0xff, 0xfe, 0xfd, 0x41]).toString("base64") })).toEqual({ ok: false, error: "sheet_refused", reason: "not_utf8" });
    expect(mockRead(file(`h\n${"1\n".repeat(5001)}`))).toEqual({ ok: false, error: "sheet_refused", reason: "too_many_rows" });
    expect(mockRead(file(`${Array.from({ length: 61 }, (_, i) => `c${i}`).join(",")}\n1`))).toEqual({ ok: false, error: "sheet_refused", reason: "too_many_columns" });
    expect(mockRead(file('a,b\n"open,1'))).toEqual({ ok: false, error: "sheet_refused", reason: "malformed_csv" });
  });
  it("a Google Sheet answers with a small made-up sheet; a private one is refused", () => {
    const ok = mockRead({ kind: "sheet", filename: null, content_base64: null, text: null, sheet_url: "https://docs.google.com/spreadsheets/d/abc/edit", use_ai: true });
    expect(ok.ok && ok.read.rows).toBe(6);
    expect(mockRead({ kind: "sheet", filename: null, content_base64: null, text: null, sheet_url: "https://docs.google.com/spreadsheets/d/private/edit", use_ai: true })).toEqual({ ok: false, error: "sheet_not_public" });
  });
});

describe("test mode: the preview", () => {
  const csv = "Name,Mobile\nA,9000000001\nB,+91 90000 00002\nC,9000000001\nD,12345\nE,\nF,9000000099\n";
  it("counts ready, duplicates inside the list, invalid and Do-Not-Disturb, and lists the problems with their row", () => {
    const out = mockPreview(preview(file(csv)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.rows_read).toBe(6);
    expect(out.preview.counts).toMatchObject({ ready: 3, duplicates_in_file: 1, invalid: 2, dnd: 1, no_consent: 3 });
    expect(out.preview.problems).toEqual([{ row: 4, reason: "duplicate_in_file" }, { row: 5, reason: "invalid_number" }, { row: 6, reason: "no_contact_way" }]);
    expect(out.preview.source).toBe(DEFAULT_TAG.file);
    expect(out.preview.dnd_lookup).toBe("checked");
  });
  it("without the consent confirmation nothing is estimated (nothing is sent), with it the estimate is there", () => {
    const without = mockPreview(preview(file(csv)));
    const withIt = mockPreview(preview(file(csv), { consent_confirmed: true }));
    expect(without.ok && without.preview.estimate).toMatchObject({ messages: 0, call_minutes: 0 });
    expect(withIt.ok && withIt.preview.counts.no_consent).toBe(0);
    expect(withIt.ok && withIt.preview.estimate).toMatchObject({ messages: 3, call_minutes: 5, basis: "estimate" });
  });
  it("a phone or an e-mail must be mapped", () => {
    expect(mockPreview(preview(file(csv), { mapping: { name: 0 } }))).toEqual({ ok: false, error: "mapping_required_missing" });
    expect(mockPreview(preview(file(csv), { mapping: { name: 0, phone: 1 } })).ok).toBe(true);
  });
  it("an e-mail alone is a way to reach someone", () => {
    const out = mockPreview(preview(file("Name,Email\nRavi,ravi@example.test\nBad,not-an-email\n")));
    expect(out.ok && out.preview.counts).toMatchObject({ ready: 1, invalid: 1 });
  });
  it("a pasted list: name and number in either order, number alone, a line with no number", () => {
    const out = mockPreview(preview(paste("Ravi, 9000000001\n9000000002, Anitha\n90000 00003\nNo number here\n")));
    expect(out.ok && out.preview.counts).toMatchObject({ ready: 3, invalid: 1 });
    expect(out.ok && out.preview.problems).toEqual([{ row: 4, reason: "no_contact_way" }]);
  });
  it("keeps at most 50 problems", () => {
    const out = mockPreview(preview(paste("x\n".repeat(80))));
    expect(out.ok && out.preview.problems).toHaveLength(50);
    expect(out.ok && out.preview.counts.invalid).toBe(80);
  });
  it("the fingerprint tells other content apart", () => {
    expect(fingerprint(preview(paste("a")))).toBe(fingerprint(preview(paste("a"))));
    expect(fingerprint(preview(paste("a")))).not.toBe(fingerprint(preview(paste("b"))));
  });
});
