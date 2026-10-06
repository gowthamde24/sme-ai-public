import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { API_CODES, COLUMNS, COLUMN_LABELS, ISSUE_CODES, ISSUE_TEXT, PARSER_CODES, commitPriceList, issueText, parseCommitted, parsePreview, previewPriceList } from "./pricelists";
import { BAD_JSON, COMMITTED_JSON, ITEM_JSON, PREVIEW_JSON, TENANT, VERSION } from "./pricelists-fixtures";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

describe("the words", () => {
  it("every closed code has a plain sentence and every column a name", () => {
    expect(ISSUE_CODES).toHaveLength(PARSER_CODES.length + API_CODES.length);
    expect(PARSER_CODES).toHaveLength(19);
    for (const code of ISSUE_CODES) expect(ISSUE_TEXT[code].endsWith(".")).toBe(true);
    for (const column of COLUMNS) expect(COLUMN_LABELS[column]).toBeTruthy();
  });
  it("an issue says where and then what; row 0 is the file", () => {
    expect(issueText({ row: 3, column: "unit_price", code: "INVALID_MONEY" })).toBe("Row 3, unit price: This is not an amount in rupees (for example 4200 or 1,200.50).");
    expect(issueText({ row: 2, column: null, code: "ROW_WIDTH" })).toBe("Row 2: The row has a different number of cells than the header.");
    expect(issueText({ row: 0, column: null, code: "FILE_LIMIT" })).toMatch(/^The file: /);
  });
});

describe("parsing is strict", () => {
  it("accepts the API's bodies", () => {
    expect(parsePreview(PREVIEW_JSON).items).toHaveLength(2);
    expect(parsePreview(BAD_JSON).issues).toHaveLength(3);
    expect(parseCommitted(COMMITTED_JSON).version_no).toBe(2);
  });
  it.each([
    ["a code we do not know", { ...BAD_JSON, issues: [{ row: 1, column: "sku", code: "SOMETHING_NEW" }] }],
    ["a column we do not know", { ...BAD_JSON, issues: [{ row: 1, column: "secret", code: "INVALID_SKU" }] }],
    ["a negative row", { ...BAD_JSON, issues: [{ row: -1, column: null, code: "FILE_LIMIT" }] }],
    ["an item price that is a string", { ...PREVIEW_JSON, items: [{ ...ITEM_JSON, unit_price_paise: "420000" }] }],
    ["a fractional price", { ...PREVIEW_JSON, items: [{ ...ITEM_JSON, unit_price_paise: 1.5 }] }],
    ["a unit we do not know", { ...PREVIEW_JSON, items: [{ ...ITEM_JSON, sale_unit: "dozen" }] }],
    ["ok that is not a boolean", { ...PREVIEW_JSON, ok: "yes" }],
    ["a break without a quantity", { ...PREVIEW_JSON, items: [{ ...ITEM_JSON, breaks: [{ unit_price_paise: 1 }] }] }],
  ])("refuses %s", (_what, body) => expect(() => parsePreview(body)).toThrow(ApiContractError));
  it("refuses a malformed commit answer", () => {
    expect(() => parseCommitted({ ...COMMITTED_JSON, replayed: "no" })).toThrow(ApiContractError);
    expect(() => parseCommitted(null)).toThrow(ApiContractError);
  });
});

describe("requests", () => {
  it("a check sends the text and the date to the tenant's own path with the caller's token", async () => {
    apiRequest.mockResolvedValue(PREVIEW_JSON);
    await previewPriceList("tok", TENANT, { csv: "sku,name\n", effectiveFrom: "2026-10-06" });
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${TENANT}/price-lists/import/preview`);
    expect(token).toBe("tok");
    expect(JSON.parse(String(init.body))).toEqual({ csv: "sku,name\n", effective_from: "2026-10-06" });
  });
  it("a save carries the version id, the text and the date, and nothing else", async () => {
    apiRequest.mockResolvedValue(COMMITTED_JSON);
    await commitPriceList("tok", TENANT, { id: VERSION, csv: "x", effectiveFrom: "2026-10-06" });
    const [path, , init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${TENANT}/price-lists/import`);
    expect(JSON.parse(String(init.body))).toEqual({ id: VERSION, csv: "x", effective_from: "2026-10-06" });
  });
  it("a malformed id never reaches a path", async () => {
    await expect(previewPriceList("tok", "../x", { csv: "x", effectiveFrom: "2026-10-06" })).rejects.toThrow(ApiContractError);
    await expect(commitPriceList("tok", TENANT, { id: "nope", csv: "x", effectiveFrom: "2026-10-06" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
