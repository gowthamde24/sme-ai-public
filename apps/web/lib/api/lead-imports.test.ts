import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError, ApiRequestError } from "./client";
import { actOnSheetLink, createSheetLink, getSheetAccess, importLeads, listLeadImports, listSheetLinks, parseCounts, parseImportResult, parsePreview, parseRead, previewLeads, readLeads } from "./lead-imports";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";
const COUNTS = { ready: 96, duplicates_merged: 18, duplicates_in_file: 4, already_imported: 0, invalid: 11, dnd: 7, no_consent: 0, blocked: 0 };
const READ = {
  kind: "file", rows: 142,
  columns: [{ index: 0, header: "పేరు", samples: ["Ravi", "Anitha"], field: "name", confidence: "exact" }, { index: 1, header: "Mob. No.", samples: ["9000000001"], field: "phone", confidence: "partial" }, { index: 2, header: "x", samples: [], field: null, confidence: "none" }],
  fields: [{ field: "name", label: "Name", required: false }, { field: "phone", label: "Phone", required: false }],
  mapping: { name: 0, phone: 1 }, mapped_by: "rules", needs_confirmation: true, warnings: ["cells_cut"],
};
const PREVIEW = { rows_read: 142, source: "excel_upload", counts: COUNTS, estimate: { messages: 96, call_minutes: 240, cost_paise: 1234, basis: "estimate" }, problems: [{ row: 12, reason: "invalid_number" }], dnd_lookup: "checked" };
const IMPORT = { import_id: ID, status: "done", source: "excel_upload", consent_id: null, counts: COUNTS, problems: [], created_at: "2026-10-26T10:00:00Z" };
const LINK = { id: ID, status: "active", source: "google_sheet", last_synced_at: null, last_row_count: null, last_result: null, last_error: null, created_at: "2026-10-26T10:00:00Z", next_sync_at: "2026-10-26T10:15:00Z" };

describe("lead imports: strict readers", () => {
  it("reads the answers of the contract", () => {
    expect(parseRead(READ).mapping).toEqual({ name: 0, phone: 1 });
    expect(parseRead(READ).columns[0].header).toBe("పేరు");
    expect(parsePreview(PREVIEW).counts.ready).toBe(96);
    expect(parseImportResult(IMPORT).status).toBe("done");
    expect(parseRead({ ...READ, mapping: null, columns: [], mapped_by: "none", needs_confirmation: false }).mapping).toBeNull();
  });
  it("a body that is not the contract is an error, never drawn", () => {
    expect(() => parseRead({ ...READ, columns: [{ ...READ.columns[0], confidence: "sure" }] })).toThrow(ApiContractError);
    expect(() => parseRead({ ...READ, columns: [{ ...READ.columns[0], field: "pincode" }] })).toThrow(ApiContractError);
    expect(() => parseRead({ ...READ, mapping: { phone: "1" } })).toThrow(ApiContractError);
    expect(() => parseRead({ ...READ, mapping: { zip: 1 } })).toThrow(ApiContractError);
    expect(() => parseRead({ ...READ, rows: -1 })).toThrow(ApiContractError);
    expect(() => parseRead(null)).toThrow(ApiContractError);
    expect(() => parsePreview({ ...PREVIEW, counts: { ...COUNTS, ready: "96" } })).toThrow(ApiContractError);
    expect(() => parsePreview({ ...PREVIEW, estimate: { ...PREVIEW.estimate, basis: "exact" } })).toThrow(ApiContractError);
    expect(() => parsePreview({ ...PREVIEW, problems: [{ row: 1, reason: "<script>" }] })).toThrow(ApiContractError);
    expect(() => parseImportResult({ ...IMPORT, import_id: "x" })).toThrow(ApiContractError);
    expect(() => parseImportResult({ ...IMPORT, created_at: "yesterday" })).toThrow(ApiContractError);
    const { blocked: _b, ...missing } = COUNTS;
    void _b;
    expect(() => parseCounts(missing)).toThrow(ApiContractError);
  });
});

describe("lead imports: the calls", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const urlOf = (f: ReturnType<typeof stub>, n = 0) => String((f.mock.calls[n] as unknown as [string])[0]);
  const bodyOf = (f: ReturnType<typeof stub>) => JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));

  it("read, preview and import post the body to the tenant's paths with the person's token", async () => {
    const body = { kind: "paste" as const, filename: null, content_base64: null, text: "x", sheet_url: null, use_ai: true };
    let f = stub(200, READ);
    await readLeads("tok", T, body);
    expect(urlOf(f)).toMatch(new RegExp(`/v1/tenants/${T}/lead-imports/read$`));
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    f = stub(200, PREVIEW);
    await previewLeads("tok", T, { ...body, mapping: null, source: null, consent_confirmed: false });
    expect(urlOf(f)).toMatch(/lead-imports\/preview$/);
    f = stub(201, IMPORT);
    await importLeads("tok", T, { ...body, mapping: null, source: null, consent_confirmed: false, import_id: ID, consent: null, cost_per_lead_paise: null });
    expect(urlOf(f)).toMatch(/lead-imports$/);
    expect(bodyOf(f).import_id).toBe(ID);
  });
  it("lists the recent imports with a limit in range", async () => {
    const f = stub(200, { items: [{ ...IMPORT, kind: "file", rows_read: 142, consent_id: null, by: "Asha" }], next_cursor: null });
    const items = await listLeadImports("tok", T, 500);
    expect(items[0].by).toBe("Asha");
    expect(urlOf(f)).toMatch(/lead-imports\?limit=100$/);
  });
  it("sheet links: access, list, create, sync (queued link), pause, resume", async () => {
    let f = stub(200, { modes: [{ mode: "anyone_with_link", available: true }, { mode: "published_csv", available: true }, { mode: "service_account", available: false, service_account_email: null }] });
    expect((await getSheetAccess("tok", T)).modes[2]).toEqual({ mode: "service_account", available: false, service_account_email: null });
    f = stub(200, { items: [LINK] });
    expect((await listSheetLinks("tok", T))[0].status).toBe("active");
    f = stub(201, LINK);
    await createSheetLink("tok", T, { link_id: ID, sheet_url: "https://docs.google.com/spreadsheets/d/a", mapping: { phone: 1 }, consent: null, cost_per_lead_paise: null });
    expect(urlOf(f)).toMatch(/lead-sheet-links$/);
    f = stub(202, { status: "queued", link: LINK });
    expect((await actOnSheetLink("tok", T, ID, "sync")).id).toBe(ID);
    expect(urlOf(f)).toMatch(new RegExp(`lead-sheet-links/${ID}/sync$`));
    f = stub(200, { ...LINK, status: "paused" });
    expect((await actOnSheetLink("tok", T, ID, "pause")).status).toBe("paused");
    f = stub(200, { ...LINK, status: "needs_attention", last_error: "columns_changed" });
    expect((await actOnSheetLink("tok", T, ID, "resume")).last_error).toBe("columns_changed");
    expect(() => parseRead(undefined)).toThrow();
    await expect(actOnSheetLink("tok", T, "not-an-id", "sync")).rejects.toThrow(ApiContractError);
    await expect(listSheetLinks("tok", "nope")).rejects.toThrow(ApiContractError);
  });
  it("a refusal carries its closed code and reason", async () => {
    stub(422, { error: { code: "sheet_refused", message: "x", reason: "too_many_rows", retry_after: null, request_id: "r" } });
    await expect(readLeads("tok", T, { kind: "paste", filename: null, content_base64: null, text: "x", sheet_url: null, use_ai: true })).rejects.toMatchObject({ status: 422, code: "sheet_refused", reason: "too_many_rows" } satisfies Partial<ApiRequestError>);
  });
});
