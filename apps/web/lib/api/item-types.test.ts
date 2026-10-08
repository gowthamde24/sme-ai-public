import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { TYPE_A_JSON, TYPE_B_JSON, TYPE_C_JSON } from "./quotes-fixtures";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchItemTypes, parseItemType, parseItemTypes, priceOutsideRange, sellableItemTypes } from "./item-types";

const TENANT = "22222222-2222-4222-8222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("parsing", () => {
  it("accepts an item type with and without a range", () => {
    expect(parseItemType(TYPE_A_JSON)).toEqual(TYPE_A_JSON);
    expect(parseItemType(TYPE_B_JSON)).toEqual(TYPE_B_JSON);
  });
  it.each([
    ["id", "x"], ["id", 5], ["code", ""], ["code", "a b"], ["code", "x".repeat(21)], ["name", ""], ["name", "  "], ["name", 4], ["position", -1], ["position", 1.5],
    ["active", "yes"], ["min_price_paise", 0], ["min_price_paise", 1.5], ["min_price_paise", "5"], ["max_price_paise", 100_000_001], ["max_price_paise", undefined],
  ])("%s = %j is a contract error", (key, value) => {
    expect(() => parseItemType({ ...TYPE_B_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a lowest price above the highest is a contract error", () => {
    expect(() => parseItemType({ ...TYPE_B_JSON, min_price_paise: 500, max_price_paise: 400 })).toThrow(ApiContractError);
  });
  it("a list must be a list", () => {
    expect(() => parseItemTypes({ items: [] })).toThrow(ApiContractError);
    expect(parseItemTypes([])).toEqual([]);
  });
});

describe("the item types a new line may use", () => {
  it("are the active ones, in the owner's order and then by code", () => {
    const more = { ...TYPE_A_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9", code: "A0", name: "Type A0", position: 1 };
    const list = parseItemTypes([TYPE_B_JSON, TYPE_C_JSON, more, TYPE_A_JSON]);
    expect(sellableItemTypes(list).map((t) => t.code)).toEqual(["A", "A0", "B"]);
  });
});

describe("priceOutsideRange (the API's price_range.py rule)", () => {
  it.each([
    [100, 200, 300, true], [199, 200, 300, true], [200, 200, 300, false], [250, 200, 300, false], [300, 200, 300, false], [301, 200, 300, true],
    [100, null, null, false], [100, null, 50, true], [40, null, 50, false], [100, 150, null, true], [150, 150, null, false], [5000, 5000, 5000, false], [4999, 5000, 5000, true], [5001, 5000, 5000, true],
  ])("price %i with range %j..%j is outside: %s", (price, min, max, outside) => {
    expect(priceOutsideRange(price, min, max)).toBe(outside);
  });
  it.each([0, -1, 1.5, Number.NaN])("a price of %s is not a price (an error, never \"inside\")", (bad) => {
    expect(() => priceOutsideRange(bad, 1, 2)).toThrow(ApiContractError);
  });
});

describe("fetchItemTypes", () => {
  it("reads the tenant's list with the user's token and parses it strictly", async () => {
    apiRequest.mockResolvedValue([TYPE_A_JSON]);
    expect(await fetchItemTypes("tok", TENANT)).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/item-types`, "tok");
    apiRequest.mockResolvedValue([{ ...TYPE_A_JSON, code: "" }]);
    await expect(fetchItemTypes("tok", TENANT)).rejects.toBeInstanceOf(ApiContractError);
  });
  it("never lets a malformed tenant id reach a path", async () => {
    await expect(fetchItemTypes("tok", "../x")).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
