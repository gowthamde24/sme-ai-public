import { createHash } from "node:crypto";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));

import { MOCK_COOKIE, MockRefusal, encodeLog, mockPreview, mockSend, parseLog } from "./mock";
import { readLog, send } from "./source";
import { parseBatches, parsePreview, parseSent } from "./types";

const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const FILE = ["phone,student,subject,marks,out of,term", "9876543210,Asha,Maths,45,50,Term 1", "9876543211,Ravi,Maths,38,50,Term 1", "9876540000,Meera,Maths,40,50,Term 1", "9876549999,Kiran,Maths,41,50,Term 1", "98x,Bad,Maths,1,50,Term 1", "9876543212,Over,Maths,60,50,Term 1", "9876543210,Asha,Maths,45,50,Term 1", "=1+1,Cell,Maths,1,50,Term 1"].join("\n");

beforeEach(() => h.jar.clear());

const examples = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "contracts", "marks_messages.examples.json"), "utf8"));

describe("C1's own example payloads (packages/contracts/marks_messages.examples.json)", () => {
  it("a preview, a preview with problems (a problem about a whole line has no column), a send and the log are all read", () => {
    expect(parsePreview(examples.preview)).toMatchObject({ willSend: 118, blocked: 1, unknownGuardian: 1, issues: [{ line: 14, code: "blocked_guardian", field: null }, { line: 77, code: "unknown_guardian", field: null }] });
    expect(parsePreview(examples.preview_with_problems)).toMatchObject({ willSend: 2, invalid: 1, duplicates: 1, issues: expect.arrayContaining([{ line: 6, code: "bad_value", field: "marks" }]) });
    expect(parseSent(examples.send_result)).toMatchObject({ sent: 118, failed: 0, blocked: 1, skipped: 2 });
    expect(parseBatches(examples.batches)).toEqual([{ batchId: "5c4d3e2f-1a0b-4c8d-9e7f-6a5b4c3d2e11", at: "2026-10-26T09:30:00Z", sent: 118, failed: 0, blocked: 1 }]);
  });
});

describe("what the API's answers must look like (contract-marks-messages.md)", () => {
  const ok = { rows: 10, will_send: 8, blocked: 1, unknown_guardian: 1, invalid: 0, duplicates: 0, by_template: { "marks.te": 5, "marks.en": 3 }, file_sha256: "a".repeat(64), issues: [{ line: 3, code: "unknown_guardian", field: "phone" }, { line: 5, code: "duplicate_row", field: null }], issues_truncated: false, example_text: "Asha scored 45 out of 50." };
  it("a preview is read field by field; anything outside the closed lists is refused", () => {
    expect(parsePreview(ok)).toMatchObject({ rows: 10, willSend: 8, blocked: 1, unknownGuardian: 1, fileSha256: "a".repeat(64), exampleText: "Asha scored 45 out of 50.", issues: [{ line: 3, field: "phone" }, { line: 5, field: null }] });
    for (const bad of [{ ...ok, will_send: -1 }, { ...ok, file_sha256: "xyz" }, { ...ok, issues: [{ line: 1, code: "other", field: "phone" }] }, { ...ok, issues: [{ line: 1, code: "bad_phone", field: "<b>" }] }, { ...ok, by_template: { "../x": 1 } }, null, "x"]) expect(parsePreview(bad)).toBeNull();
  });
  it("a send says how many were sent, failed, blocked, handled before and skipped", () => {
    expect(parseSent({ sent: 8, failed: 0, blocked: 1, already_handled: 0, skipped: 1, batch_id: "b", file_kept: false })).toEqual({ sent: 8, failed: 0, blocked: 1, alreadyHandled: 0, skipped: 1, batchId: "b" });
    expect(parseSent({ sent: "8" })).toBeNull();
  });
  it("the log keeps only batches of its shape", () => {
    expect(parseBatches({ items: [{ batch_id: "b1", created_at: "2026-10-26T10:00:00Z", sent: 3, failed: 0, blocked: 1 }, { nonsense: true }] })).toEqual([{ batchId: "b1", at: "2026-10-26T10:00:00Z", sent: 3, failed: 0, blocked: 1 }]);
    expect(parseBatches(null)).toEqual([]);
  });
});

describe("the fake send of the test screens", () => {
  it("counts what would be sent, what is blocked, unknown, wrong, repeated and a formula, by the contract's rules", () => {
    const p = mockPreview(bytes(FILE), "marks", "te", "");
    expect(p).toMatchObject({ rows: 8, willSend: 2, blocked: 1, unknownGuardian: 1, invalid: 3, duplicates: 1 });
    expect(p.byTemplate).toEqual({ "marks.te": 2 });
    expect(p.issues.map((i) => i.code).sort()).toEqual(["bad_phone", "bad_value", "blocked_guardian", "duplicate_row", "formula_cell", "unknown_guardian"]);
    expect(p.exampleText).toContain("Asha");
    expect(p.fileSha256).toBe(createHash("sha256").update(Buffer.from(FILE)).digest("hex"));
  });
  it("a file with no exam column needs the exam name; a missing column, an empty file and a file that is not text are refused with the API's closed codes", () => {
    const noTerm = FILE.split("\n").map((l) => l.split(",").slice(0, 5).join(",")).join("\n");
    expect(() => mockPreview(bytes(noTerm), "marks", "en", "")).toThrow(MockRefusal);
    expect(mockPreview(bytes(noTerm), "marks", "en", "Term 1").willSend).toBe(2);
    for (const [file, code] of [[bytes("phone,student\n"), "marks_file_empty"], [bytes("phone,student,subject\n1,2,3"), "marks_file_missing_column"], [new Uint8Array([0xff, 0xfe, 0x00]).buffer as ArrayBuffer, "marks_file_not_utf8"], [new ArrayBuffer(0), "marks_file_empty"]] as const) {
      expect(() => mockPreview(file, "marks", "en", "T"), code).toThrow(expect.objectContaining({ code }));
    }
  });
  it("only the file that was previewed can be sent: another file or a changed count is refused and nothing is logged", async () => {
    const p = mockPreview(bytes(FILE), "marks", "te", "");
    expect(() => mockSend(bytes(FILE + "\n9876543299,New,Maths,1,50,Term 1"), "marks", "te", "", "b", p.fileSha256, p.willSend)).toThrow(expect.objectContaining({ code: "marks_file_changed" }));
    expect(() => mockSend(bytes(FILE), "marks", "te", "", "b", p.fileSha256, p.willSend + 1)).toThrow(expect.objectContaining({ code: "marks_count_changed" }));
    expect(mockSend(bytes(FILE), "marks", "te", "", "b", p.fileSha256, p.willSend)).toMatchObject({ sent: 2, blocked: 1, failed: 0, batchId: "b" });
  });
  it("a send leaves ONE log line (counts and a time) and no mark, no name, no file", async () => {
    vi.stubEnv("MARKS_SCREENS", "mock");
    const p = mockPreview(bytes(FILE), "marks", "te", "");
    await send({ token: "t", tenantId: "x" }, bytes(FILE), "text/csv", { kind: "marks", language: "te", term: "", batchId: "11111111-1111-4111-8111-111111111111", sha256: p.fileSha256, count: p.willSend });
    const stored = h.jar.get(MOCK_COOKIE)!;
    expect(stored).not.toMatch(/Asha|Ravi|Maths|45|9876|Term/);
    expect(await readLog({ token: "t", tenantId: "x" })).toEqual([expect.objectContaining({ batchId: "11111111-1111-4111-8111-111111111111", sent: 2, blocked: 1 })]);
    expect(parseLog("{broken")).toEqual([]);
    expect(parseLog(encodeLog([]))).toEqual([]);
    vi.unstubAllEnvs();
  });
});
