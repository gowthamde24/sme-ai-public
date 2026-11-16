import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { listPriceAsks, markPriceAskAnswered, parsePriceAsk } from "./price-asks";

const T = "22222222-2222-4222-8222-222222222222";
const A = "99999999-9999-4999-8999-999999999991";
const LEAD = "33333333-3333-4333-8333-333333333333";
const ROW = { id: A, item: "Semi silk tissue", source: "whatsapp", kind: "price", needed_by: "2026-11-23", lead_id: LEAD, customer: "Kavitha Gowda", asked_at: "2026-11-16T15:00:00Z", answered_at: null };
beforeEach(() => vi.clearAllMocks());

describe("price questions and promises", () => {
  it("reads a row: kind, the day they need it by, the lead and the customer", () => {
    expect(parsePriceAsk(ROW)).toEqual({ id: A, item: "Semi silk tissue", kind: "price", neededBy: "2026-11-23", leadId: LEAD, customer: "Kavitha Gowda", askedAt: "2026-11-16T15:00:00Z" });
    expect(parsePriceAsk({ ...ROW, kind: "follow_up", needed_by: null, lead_id: null, customer: "" })).toMatchObject({ kind: "follow_up", neededBy: null, leadId: null, customer: null });
  });
  it("an API from before `kind` sent only price questions; a day that is not a day is no deadline", () => {
    const { kind: _k, ...old } = ROW;
    expect(parsePriceAsk(old).kind).toBe("price");
    expect(parsePriceAsk({ ...ROW, needed_by: "Sunday" }).neededBy).toBeNull();
  });
  it("asks for the open ones, earliest first as sent; one bad row is left out and the rest load", async () => {
    apiRequest.mockResolvedValueOnce({ items: [ROW, { id: "nope" }, { ...ROW, id: "99999999-9999-4999-8999-999999999992", kind: "follow_up" }] });
    const got = await listPriceAsks("tok", T);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/price-asks?open=true&limit=20`, "tok");
    expect(got.map((x) => x.kind)).toEqual(["price", "follow_up"]);
  });
  it("Done posts to the item's own path; an id that is not an id never reaches the API", async () => {
    apiRequest.mockResolvedValueOnce({});
    await markPriceAskAnswered("tok", T, A);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/price-asks/${A}/answered`, "tok", { method: "POST" });
    await expect(markPriceAskAnswered("tok", T, "../x")).rejects.toBeTruthy();
  });
});
