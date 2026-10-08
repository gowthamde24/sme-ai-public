import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { createProduct: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/products", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/products")>()), createProduct: (...a: unknown[]) => api.createProduct(...a) }));

import { addProductAction } from "./actions";

const T = "22222222-2222-2222-2222-222222222222";
const P = "66666666-6666-4666-8666-666666666666";
const CANARY = "CANARY-9b31d0";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = { id: P, sku: "KJ-RED", name: "Kanjivaram red", unit: "piece", category: "" };
  for (const [k, v] of Object.entries({ ...base, ...over })) data.set(k, v);
  return data;
}
const run = (over: Record<string, string> = {}) => addProductAction(T, undefined, form(over));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
  api.createProduct.mockResolvedValue(P);
});

describe("addProductAction", () => {
  it("authenticates first and sends the page's id with the user's token; no category when empty", async () => {
    const r = await run();
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(api.createProduct).toHaveBeenCalledWith("tok", T, { id: P, sku: "KJ-RED", name: "Kanjivaram red", unit: "piece", category: null });
    expect(r).toEqual({ ok: true, name: "Kanjivaram red", sku: "KJ-RED" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`);
  });
  it("sends the category when given, and a Telugu name as it is", async () => {
    await run({ category: "saree", name: "కాంజీవరం", unit: "set" });
    expect(api.createProduct).toHaveBeenCalledWith("tok", T, { id: P, sku: "KJ-RED", name: "కాంజీవరం", unit: "set", category: "saree" });
  });
  it.each([
    [{ sku: "" }, /code may use/],
    [{ sku: "=cmd" }, /code may use/],
    [{ sku: "has space" }, /code may use/],
    [{ sku: "x".repeat(41) }, /code may use/],
    [{ name: " " }, /Enter a name/],
    [{ name: "x".repeat(201) }, /Enter a name/],
    [{ unit: "kilo" }, /Piece or Set/],
    [{ category: "x".repeat(65) }, /category is too long/],
    [{ id: "x" }, /out of date/],
  ])("refuses %j before the API is called", async (over, message) => {
    const r = await run(over);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(message);
    expect(api.createProduct).not.toHaveBeenCalled();
  });
  it("a malformed workspace id never reaches the API", async () => {
    expect((await addProductAction("x", undefined, form()))?.error).toBe("This workspace is not available.");
    expect(api.createProduct).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    api.createProduct.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
  it.each([
    [new ApiRequestError(403, "forbidden", CANARY), /Your role cannot add products/],
    [new ApiRequestError(404, "not_found", CANARY), /workspace is not available/],
    [new ApiRequestError(409, "conflict", CANARY), /already used/],
    [new ApiRequestError(422, "validation_error", CANARY), /Check the values/],
    [new ApiRequestError(503, "api_unreachable", CANARY), /Could not save the product/],
    [new Error(CANARY), /Could not save the product/],
  ])("%s becomes a short sentence of our own, and nothing the API said is echoed", async (error, sentence) => {
    api.createProduct.mockRejectedValue(error);
    const r = await run();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(sentence);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
