import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { createProduct, SKU_PATTERN } from "./products";

const T = "22222222-2222-2222-2222-222222222222";
const P = "66666666-6666-4666-8666-666666666666";
const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));
afterEach(() => vi.clearAllMocks());

describe("createProduct", () => {
  it("sends the code, name and unit, and the category only when given", async () => {
    apiRequest.mockResolvedValue({ id: P });
    expect(await createProduct("tok", T, { id: P, sku: "KJ-RED", name: "Kanjivaram red", unit: "piece", category: null })).toBe(P);
    const [path, token, init] = apiRequest.mock.calls[0] as [string, string, RequestInit];
    expect(path).toBe(`/v1/tenants/${T}/products`);
    expect(token).toBe("tok");
    expect(JSON.parse(String(init.body))).toEqual({ id: P, sku: "KJ-RED", name: "Kanjivaram red", unit: "piece" });
    await createProduct("tok", T, { id: P, sku: "KJ-RED", name: "n", unit: "set", category: "saree" });
    expect(JSON.parse(String((apiRequest.mock.calls[1] as [string, string, RequestInit])[2].body)).category).toBe("saree");
  });
  it.each([[{}], [{ id: 1 }], [null], [[]]])("an answer without a proper id (%j) is an error", async (answer) => {
    apiRequest.mockResolvedValue(answer);
    await expect(createProduct("tok", T, { id: P, sku: "A", name: "n", unit: "piece", category: null })).rejects.toThrow(ApiContractError);
  });
  it("refuses malformed ids before any request", async () => {
    await expect(createProduct("tok", "x", { id: P, sku: "A", name: "n", unit: "piece", category: null })).rejects.toThrow(ApiContractError);
    await expect(createProduct("tok", T, { id: "x", sku: "A", name: "n", unit: "piece", category: null })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("SKU_PATTERN is the price-list file's rule", () => {
  it.each(["KJ-RED", "kj_red.01", "A", "x".repeat(40)])("accepts %s", (s) => expect(SKU_PATTERN.test(s)).toBe(true));
  it.each(["", "=cmd", "+1", "-1", "@x", "a b", "x".repeat(41), "ఆ", "a/b"])("refuses %j", (s) => expect(SKU_PATTERN.test(s)).toBe(false));
});
