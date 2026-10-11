import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { parseLeadSearch, searchLeads } from "./lead-search";

const TENANT = "22222222-2222-4222-8222-222222222222";
const LEAD = "c5c78ed6-e536-46af-a5c3-872bb2d844a2";
const row = { lead_id: LEAD, customer: "Sri Lakshmi Silks", city: "Hyderabad", contact_name: "Priya S.", phone_last4: "0001", created_at: "2026-10-05T09:00:00Z" };
beforeEach(() => vi.clearAllMocks());

describe("lead search", () => {
  it("reads the names, the city and the last four digits: never a number", () => {
    const { items, next_cursor } = parseLeadSearch({ items: [row], next_cursor: null });
    expect(items).toEqual([{ leadId: LEAD, customer: "Sri Lakshmi Silks", city: "Hyderabad", contactName: "Priya S.", phoneLast4: "0001" }]);
    expect(next_cursor).toBeNull();
    expect(JSON.stringify(items)).not.toMatch(/\d{5,}/);
  });

  it("a phone ending that is not four digits is never shown: letters are dropped, and more than four characters (a number) is a broken answer", () => {
    expect(parseLeadSearch({ items: [{ ...row, phone_last4: "12ab" }], next_cursor: null }).items[0]?.phoneLast4).toBeNull();
    expect(() => parseLeadSearch({ items: [{ ...row, phone_last4: "98765" }], next_cursor: null })).toThrow(ApiContractError);
  });

  it("refuses an answer that breaks the contract", () => {
    expect(() => parseLeadSearch({ items: [{ ...row, lead_id: "x" }], next_cursor: null })).toThrow(ApiContractError);
    expect(() => parseLeadSearch({ items: "no" })).toThrow(ApiContractError);
  });

  it("asks the API for names of two letters or more only, encoded, and returns the hits", async () => {
    apiRequest.mockResolvedValue({ items: [row], next_cursor: null });
    expect(await searchLeads("tok", TENANT, "a")).toEqual([]);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(await searchLeads("tok", TENANT, "x".repeat(61))).toEqual([]);
    const hits = await searchLeads("tok", TENANT, " Sri & Co ");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/leads/search?q=Sri%20%26%20Co&limit=8`, "tok");
    expect(hits).toHaveLength(1);
    await expect(searchLeads("tok", "nope", "Sri")).rejects.toThrow(ApiContractError);
  });
});
