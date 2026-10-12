import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
const apiUploadRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  apiRequest: (...a: unknown[]) => apiRequest(...a),
  apiUploadRequest: (...a: unknown[]) => apiUploadRequest(...a),
  publicApiBase: () => "https://api.example.test/",
}));

import { confirmSpreadsheet, createCalendarFeed, getCalendarFeed, getExportFormats, inspectSpreadsheet, listImportJobs, parseCalendarFeed, parseConfirmed, parseExportFormats, parseInspected, parseNewCalendarFeed, parsePreviewed, previewSpreadsheet, revokeCalendarFeed } from "./data";

const T = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const FILE = new TextEncoder().encode("a,b").buffer;

const INSPECT = {
  kind: "customers",
  file_sha256: "a".repeat(64),
  file_kind: "csv",
  rows: 3,
  columns: [
    { index: 0, header: "Party Name", suggested_field: "company_name", confidence: "exact" },
    { index: 1, header: "Mobile", suggested_field: "contact_phone", confidence: "partial" },
    { index: 2, header: "Misc", suggested_field: null, confidence: "none" },
  ],
  suggested_mapping: { company_name: 0, contact_phone: 1 },
  fields: [
    { field: "company_name", label: "Customer or shop name", required: true },
    { field: "contact_phone", label: "Phone or WhatsApp number", required: false },
  ],
  sample: [["Ravi Silks", "98765 43210", "x"]],
  cut_cells: 0,
};
const PREVIEW = {
  job: { id: JOB, kind: "customers", status: "previewed", counts: {}, created_at: "2026-10-12T10:00:00Z", completed_at: null },
  counts: { rows: 3, usable: 2, will_create: 1, duplicate: 1, needs_review: 0, rejected: 0, file_problems: 1 },
  rows: [
    { line: 2, status: "will_create", reason: null, label: "Ravi Silks", city: "Guntur", note: "contact_named_after_company" },
    { line: 3, status: "duplicate", reason: null, label: "Old Shop", city: null, note: null },
  ],
  issues: [{ line: 4, code: "formula_cell", field: "city" }],
  mapping: { company_name: 0, contact_phone: 1 },
};

beforeEach(() => vi.clearAllMocks());

describe("reading the import's answers", () => {
  it("reads the columns, the suggested mapping, the fields and the sample", () => {
    const r = parseInspected(INSPECT);
    expect(r.columns[0]).toEqual({ index: 0, header: "Party Name", suggested_field: "company_name", confidence: "exact" });
    expect(r.suggested_mapping).toEqual({ company_name: 0, contact_phone: 1 });
    expect(r.fields[0]).toEqual({ field: "company_name", label: "Customer or shop name", required: true });
    expect(r.sample).toEqual([["Ravi Silks", "98765 43210", "x"]]);
  });
  it("reads a preview: the job, the counts, a verdict per row, the problems", () => {
    const r = parsePreviewed(PREVIEW);
    expect(r.job_id).toBe(JOB);
    expect(r.counts.will_create).toBe(1);
    expect(r.rows.map((x) => x.status)).toEqual(["will_create", "duplicate"]);
    expect(r.rows[0].note).toBe("contact_named_after_company");
    expect(r.issues).toEqual([{ line: 4, code: "formula_cell", field: "city" }]);
  });
  it("reads a finished import, and one that was already run (replay, no result)", () => {
    const done = parseConfirmed({ job: { ...PREVIEW.job, status: "completed" }, replay: false, result: { counts: { created: 1 }, rows: PREVIEW.rows, issues: [] } });
    expect(done.result?.counts.created).toBe(1);
    const again = parseConfirmed({ job: { ...PREVIEW.job, status: "completed" }, replay: true, result: null });
    expect(again.replay).toBe(true);
    expect(again.result).toBeNull();
  });
  it.each([
    ["a kind we do not know", { ...INSPECT, kind: "invoices" }],
    ["a confidence we do not know", { ...INSPECT, columns: [{ index: 0, header: "x", suggested_field: null, confidence: "sure" }] }],
    ["a field word with spaces", { ...INSPECT, suggested_mapping: { "company name": 0 } }],
    ["rows that are not a number", { ...INSPECT, rows: "3" }],
  ])("%s is a contract error", (_n, json) => {
    expect(() => parseInspected(json)).toThrow(ApiContractError);
  });
  it("a row status or reason that is not a closed word is a contract error (it would be drawn)", () => {
    expect(() => parsePreviewed({ ...PREVIEW, rows: [{ line: 2, status: "<b>x</b>", reason: null, label: "a" }] })).toThrow(ApiContractError);
    expect(() => parsePreviewed({ ...PREVIEW, rows: [{ line: 2, status: "rejected", reason: "a b", label: "a" }] })).toThrow(ApiContractError);
  });
  it("keeps a customer's own words (a label) as text, bounded", () => {
    expect(() => parsePreviewed({ ...PREVIEW, rows: [{ line: 2, status: "rejected", reason: null, label: "x".repeat(301) }] })).toThrow(ApiContractError);
  });
});

describe("asking the API", () => {
  it("sends the file as it is to inspect, with the kind in the query", async () => {
    apiUploadRequest.mockResolvedValue(INSPECT);
    await inspectSpreadsheet("tok", T, "customers", FILE, "text/csv");
    expect(apiUploadRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/imports/spreadsheet/inspect?kind=customers`, "tok", FILE, "text/csv");
  });
  it("sends the job and the chosen columns to preview, the job alone to confirm", async () => {
    apiUploadRequest.mockResolvedValueOnce(PREVIEW);
    await previewSpreadsheet("tok", T, "customers", JOB, { company_name: 0 }, FILE, "text/csv");
    const url = apiUploadRequest.mock.calls[0][0] as string;
    expect(url).toContain(`/imports/spreadsheet/preview?`);
    expect(new URL(`https://x${url}`).searchParams.get("job_id")).toBe(JOB);
    expect(JSON.parse(new URL(`https://x${url}`).searchParams.get("mapping") ?? "")).toEqual({ company_name: 0 });
    apiUploadRequest.mockResolvedValueOnce({ job: PREVIEW.job, replay: false, result: null });
    await confirmSpreadsheet("tok", T, JOB, FILE, "text/csv");
    expect(apiUploadRequest.mock.calls[1][0]).toBe(`/v1/tenants/${T}/imports/spreadsheet/${JOB}/confirm`);
  });
  it("refuses a kind, a job or a workspace id that is not what it should be, before asking", async () => {
    await expect(inspectSpreadsheet("tok", T, "invoices", FILE, "x")).rejects.toThrow(ApiContractError);
    await expect(previewSpreadsheet("tok", T, "customers", "not-a-uuid", null, FILE, "x")).rejects.toThrow(ApiContractError);
    await expect(confirmSpreadsheet("tok", "bad", JOB, FILE, "x")).rejects.toThrow(ApiContractError);
    expect(apiUploadRequest).not.toHaveBeenCalled();
  });
  it("reads the jobs and the file types", async () => {
    apiRequest.mockResolvedValueOnce({ jobs: [PREVIEW.job] });
    expect((await listImportJobs("tok", T))[0].status).toBe("previewed");
    apiRequest.mockResolvedValueOnce({ formats: [{ format: "tally_zip", description: "x" }, { format: "csv", description: "y" }] });
    expect(await getExportFormats("tok", T)).toEqual(["tally_zip", "csv"]);
    expect(() => parseExportFormats({ formats: [{ format: "pdf" }] })).toThrow(ApiContractError);
  });
});

describe("the calendar address", () => {
  it("reads the state, never a token", async () => {
    apiRequest.mockResolvedValue({ active: true, created_at: "2026-10-12T10:00:00Z", last_used_at: null });
    expect(await getCalendarFeed("tok", T)).toEqual({ active: true, created_at: "2026-10-12T10:00:00Z", last_used_at: null });
    expect(parseCalendarFeed({ active: false, created_at: null, last_used_at: null }).active).toBe(false);
  });
  it("builds the address from the API's public address and the path it gave, and a webcal form", async () => {
    apiRequest.mockResolvedValue({ token: "ignored", path: `/v1/calendar/feed/${"A1b2C3d4".repeat(6)}.ics`, created_at: "2026-10-12T10:00:00Z", shown_once: true });
    const feed = await createCalendarFeed("tok", T);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/calendar-feed`, "tok", { method: "POST" });
    expect(feed.url).toBe(`https://api.example.test/v1/calendar/feed/${"A1b2C3d4".repeat(6)}.ics`);
    expect(feed.webcal).toBe(`webcal://api.example.test/v1/calendar/feed/${"A1b2C3d4".repeat(6)}.ics`);
  });
  it("refuses a path that is not a feed path (it would be put in front of a person as a link)", () => {
    for (const path of ["https://evil.test/x.ics", "/v1/calendar/feed/../x.ics", "/v1/tenants/x", "/v1/calendar/feed/short.ics"]) expect(() => parseNewCalendarFeed({ path, created_at: "2026-10-12T10:00:00Z" }, "https://api.example.test")).toThrow(ApiContractError);
  });
  it("revokes with a POST (this API has no DELETE) and says how many it stopped", async () => {
    apiRequest.mockResolvedValue({ active: false, revoked: 1 });
    expect(await revokeCalendarFeed("tok", T)).toBe(1);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/calendar-feed/revoke`, "tok", { method: "POST" });
  });
});
