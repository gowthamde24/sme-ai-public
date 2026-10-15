import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { COLLECTION_REPORT_JSON, REPORT_CATALOGUE_JSON } from "./education-fixtures";
import { getReportCatalogue, parseReport, runReport } from "./reports";

const T = "22222222-2222-2222-2222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("a report as the API sends it", () => {
  it("reads figures, typed tables and series", () => {
    const r = parseReport(COLLECTION_REPORT_JSON);
    expect(r.kpis.find((k) => k.key === "collection_pct")).toEqual({ key: "collection_pct", value: 87.2, unit: "percent" });
    expect(r.tables[0]).toMatchObject({ key: "by_programme", columns: [{ type: "text" }, { type: "count" }, { type: "paise" }, { type: "paise" }, { type: "percent" }], rows: [["Class 5 (synthetic)", 31, 58000000, 7400000, 87.2]] });
    expect(r.series[0].points).toHaveLength(2);
  });
  it("a figure that cannot be worked out (a percent of nothing) is null, not zero", () => {
    expect(parseReport({ ...COLLECTION_REPORT_JSON, kpis: [{ key: "collection_pct", value: null, unit: "percent" }] }).kpis[0].value).toBeNull();
  });
  it.each([
    ["a unit that does not exist", { kpis: [{ key: "x", value: 1, unit: "furlongs" }] }], ["a row of the wrong width", { tables: [{ key: "t", columns: [{ key: "a", type: "text" }], rows: [["a", "b"]] }] }], ["a column type that does not exist", { tables: [{ key: "t", columns: [{ key: "a", type: "html" }], rows: [] }] }],
    ["a cell that is an object", { tables: [{ key: "t", columns: [{ key: "a", type: "text" }], rows: [[{}]] }] }], ["a day that is not a day", { series: [{ key: "s", points: [{ day: "yesterday", value: 1 }] }] }], ["a figure that is not a number", { kpis: [{ key: "x", value: "9", unit: "count" }] }],
  ])("%s is a contract error", (_n, over) => {
    expect(() => parseReport({ ...COLLECTION_REPORT_JSON, ...over })).toThrow(ApiContractError);
  });
});

describe("asking for reports", () => {
  it("reads the catalogue and runs a report for a range of India days", async () => {
    apiRequest.mockResolvedValueOnce(REPORT_CATALOGUE_JSON).mockResolvedValueOnce(COLLECTION_REPORT_JSON);
    expect((await getReportCatalogue("tok", T)).items.map((i) => i.code)).toEqual(["education.collection", "education.today"]);
    await runReport("tok", T, "education.collection", { from: "2026-06-01", to: "2026-10-14" });
    expect(apiRequest.mock.calls[0][0]).toBe(`/v1/tenants/${T}/reports/catalogue`);
    expect(apiRequest.mock.calls[1][0]).toBe(`/v1/tenants/${T}/reports/run/education.collection?from=2026-06-01&to=2026-10-14`);
  });
  it("a code or a date that is not one never leaves", async () => {
    await expect(runReport("tok", T, "../../etc", {})).rejects.toThrow(ApiContractError);
    await expect(runReport("tok", T, "education.collection", { from: "June" })).rejects.toThrow(ApiContractError);
    await expect(runReport("tok", "x", "education.collection")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
