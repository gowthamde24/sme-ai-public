import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { slotsJson, visitJson } from "@/lib/api/visits-fixtures";

const apiRequest = vi.fn();
const fetchPage = vi.fn();
const listVisits = vi.fn();
const getSlots = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
vi.mock("@/lib/api/crm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/crm")>()), fetchPage: (...a: unknown[]) => fetchPage(...a) }));
vi.mock("@/lib/api/visits", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/visits")>()), listVisits: (...a: unknown[]) => listVisits(...a), getSlots: (...a: unknown[]) => getSlots(...a) }));

import { readDay, readVisit, searchCustomers } from "./visits-data";

const T = "22222222-2222-4222-8222-222222222222";
const company = (id: string, name: string, city: string | null = null) => ({ id, name, city, type: "prospect", website: null, country: null, industry: null, created_via: "manual", created_at: "2026-10-01T00:00:00Z" });
const lead = (id: string, company_id: string | null) => ({ id, company_id, status: "new", source: null, created_via: "manual", created_at: "2026-10-01T00:00:00Z" });
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "11111111-1111-4111-8111-222222222222";
const L1 = "aaaaaaaa-1111-4111-8111-000000000001";
const L2 = "aaaaaaaa-1111-4111-8111-000000000002";
const L3 = "aaaaaaaa-1111-4111-8111-000000000003";

beforeEach(() => vi.clearAllMocks());

describe("readDay", () => {
  it("reads the visits and the slots of one day, each on its own", async () => {
    listVisits.mockResolvedValue({ from: "2026-10-14", to: "2026-10-14", items: [] });
    getSlots.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    expect(await readDay("tok", T, "2026-10-14")).toEqual({ visits: [], slots: null });
    expect(listVisits).toHaveBeenCalledWith("tok", T, { from: "2026-10-14", to: "2026-10-14" });
    listVisits.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    getSlots.mockResolvedValue(slotsJson("2026-10-14"));
    expect((await readDay("tok", T, "2026-10-14")).visits).toBeNull();
  });
  it("a rejected session is thrown", async () => {
    listVisits.mockRejectedValue(new ApiAuthError("x"));
    getSlots.mockResolvedValue(slotsJson("2026-10-14"));
    await expect(readDay("tok", T, "2026-10-14")).rejects.toThrow(ApiAuthError);
  });
});

describe("readVisit", () => {
  it("reads one visit by id, and is null for a bad id or one that cannot be read", async () => {
    apiRequest.mockResolvedValue(visitJson());
    expect((await readVisit("tok", T, "d894bfa2-0aaf-4700-85a9-70e4fa125fc1"))?.date).toBe("2026-10-14");
    expect(await readVisit("tok", T, "../x")).toBeNull();
    apiRequest.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await readVisit("tok", T, "d894bfa2-0aaf-4700-85a9-70e4fa125fc1")).toBeNull();
  });
});

describe("searchCustomers", () => {
  const companies = (items: unknown[]) => ({ items, next_cursor: null });
  it("finds companies by name and keeps the newest leads that belong to them: the name and the city, nothing else", async () => {
    apiRequest.mockResolvedValue(companies([company(C1, "Sri Lakshmi Silks", "Hyderabad"), company(C2, "Sri Textiles")]));
    fetchPage.mockResolvedValue({ entity: "leads", items: [lead(L1, C1), lead(L2, "11111111-1111-4111-8111-999999999999"), lead(L3, C2)], nextCursor: null });
    const hits = await searchCustomers("tok", T, "  Sri  ");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/companies?limit=20&q=Sri`, "tok");
    expect(hits).toEqual([{ leadId: L1, label: "Sri Lakshmi Silks", city: "Hyderabad" }, { leadId: L3, label: "Sri Textiles", city: null }]);
  });
  it("looks at up to four pages of leads and stops at ten answers", async () => {
    apiRequest.mockResolvedValue(companies([company(C1, "Sri")]));
    fetchPage.mockImplementation(async () => ({ entity: "leads", items: Array.from({ length: 25 }, (_, i) => lead(`aaaaaaaa-1111-4111-8111-${String(i).padStart(12, "0")}`, C1)), nextCursor: "next" }));
    expect(await searchCustomers("tok", T, "Sri")).toHaveLength(10);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    apiRequest.mockResolvedValue(companies([company(C2, "Other")]));
    fetchPage.mockImplementation(async () => ({ entity: "leads", items: [], nextCursor: "next" }));
    fetchPage.mockClear();
    await searchCustomers("tok", T, "Other");
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });
  it("a name that is too short or too long, or that matches no company, asks for nothing more", async () => {
    expect(await searchCustomers("tok", T, "S")).toEqual([]);
    expect(await searchCustomers("tok", T, "x".repeat(101))).toEqual([]);
    expect(apiRequest).not.toHaveBeenCalled();
    apiRequest.mockResolvedValue(companies([]));
    expect(await searchCustomers("tok", T, "Nobody")).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it("puts the name in the query safely", async () => {
    apiRequest.mockResolvedValue(companies([]));
    await searchCustomers("tok", T, "A&B Silks/../x");
    expect(apiRequest.mock.calls[0][0]).toBe(`/v1/tenants/${T}/companies?limit=20&q=A%26B%20Silks%2F..%2Fx`);
  });
});
