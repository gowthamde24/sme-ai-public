import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseCommitted, parsePreview } from "@/lib/api/pricelists";
import { BAD_JSON, COMMITTED_JSON, PREVIEW_JSON, TENANT, VERSION } from "@/lib/api/pricelists-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { previewPriceList: vi.fn(), commitPriceList: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/pricelists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/pricelists")>()),
  previewPriceList: (...a: unknown[]) => api.previewPriceList(...a),
  commitPriceList: (...a: unknown[]) => api.commitPriceList(...a),
}));

import { commitPriceListAction, previewPriceListAction } from "./price-list-actions";

const CANARY = "CANARY-90bb12";
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const FILE = { csv: "sku,name,unit_price,moq,tax_bps\nA,x,1,1,0\n", effective_from: "2026-10-06" };
const check = (over: Record<string, string> = {}) => previewPriceListAction(TENANT, undefined, form({ ...FILE, ...over }));
const save = (over: Record<string, string> = {}) => commitPriceListAction(TENANT, undefined, form({ ...FILE, version_id: VERSION, ...over }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.previewPriceList.mockResolvedValue(parsePreview(PREVIEW_JSON));
  api.commitPriceList.mockResolvedValue(parseCommitted(COMMITTED_JSON));
});

describe("previewPriceListAction", () => {
  it("authenticates first and sends the text and the date; the answer is the API's preview", async () => {
    const r = await check();
    expect(r?.ok).toBe(true);
    expect(r?.preview?.items).toHaveLength(2);
    expect(api.previewPriceList).toHaveBeenCalledWith("tok", TENANT, { csv: FILE.csv, effectiveFrom: "2026-10-06" });
    expect(revalidatePath).not.toHaveBeenCalled(); // a check writes nothing
  });
  it("a file with problems is an answer, not an error", async () => {
    api.previewPriceList.mockResolvedValue(parsePreview(BAD_JSON));
    expect((await check())?.preview?.issues).toHaveLength(3);
  });
  it("refuses an empty or oversized file and a malformed date before the API is called", async () => {
    expect((await check({ csv: "   " }))?.error).toBe("Paste the file's text or choose a file first.");
    expect((await check({ csv: "x".repeat(2 * 1024 * 1024 + 1) }))?.error).toBe("The file is too big: at most 2 MB.");
    for (const effective_from of ["", "soon", "06/10/2026", "2026-1-6"]) expect((await check({ effective_from }))?.error).toBe("Choose the date the price list starts.");
    expect((await previewPriceListAction("x", undefined, form(FILE)))?.ok).toBe(false);
    expect(api.previewPriceList).not.toHaveBeenCalled();
  });
  it.each([
    [new ApiRequestError(403, "mfa_required", CANARY), /authenticator app/],
    [new ApiRequestError(403, "forbidden", CANARY), /Only an owner or an admin/],
    [new ApiRequestError(503, "price_csv_unavailable", CANARY), /not available right now/],
    [new ApiRequestError(422, "validation_error", CANARY), /not accepted/],
    [new Error(CANARY), /Could not do that/],
  ])("answers in our own words and never echoes anything (%#)", async (error, words) => {
    api.previewPriceList.mockRejectedValue(error);
    const r = await check();
    expect(r?.error).toMatch(words);
    expect(JSON.stringify(r)).not.toContain(CANARY);
  });
  it("a rejected session goes to sign-in", async () => {
    api.previewPriceList.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => check())).toBe("/login");
  });
});

describe("commitPriceListAction", () => {
  it("sends the version id, the text and the date and says what was saved, and that nothing was sent", async () => {
    const r = await save();
    expect(api.commitPriceList).toHaveBeenCalledWith("tok", TENANT, { id: VERSION, csv: FILE.csv, effectiveFrom: "2026-10-06" });
    expect(r).toEqual({ ok: true, message: "Saved: price list version 2 with 2 products, in force from 6 Oct 2026. Nothing was sent to anyone." });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/price-list`);
  });
  it("a retry says it was already saved", async () => {
    api.commitPriceList.mockResolvedValue(parseCommitted({ ...COMMITTED_JSON, replayed: true }));
    expect((await save())?.message).toMatch(/^Already saved: /);
  });
  it("refuses a stale form, a malformed id or a bad file before the API is called", async () => {
    expect((await save({ version_id: "x" }))?.error).toMatch(/out of date/);
    expect((await save({ version_id: "" }))?.error).toMatch(/out of date/);
    expect((await commitPriceListAction("x", undefined, form({ ...FILE, version_id: VERSION })))?.ok).toBe(false);
    expect((await save({ csv: "" }))?.ok).toBe(false);
    expect(api.commitPriceList).not.toHaveBeenCalled();
  });
  it.each([
    [new ApiRequestError(403, "mfa_required", CANARY), /authenticator app/],
    [new ApiRequestError(422, "price_list_invalid", CANARY), /Check it first/],
    [new ApiRequestError(409, "conflict", CANARY), /out of date/],
    [new ApiRequestError(422, "invalid_value", CANARY), /dated before the latest/],
    [new ApiRequestError(422, "invalid_reference", CANARY), /no longer in your catalog/],
    [new ApiRequestError(503, "x", CANARY), /not available right now/],
    [new Error(CANARY), /Could not do that/],
  ])("answers in our own words and never echoes anything (%#)", async (error, words) => {
    api.commitPriceList.mockRejectedValue(error);
    const r = await save();
    expect(r?.error).toMatch(words);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("a rejected session goes to sign-in", async () => {
    api.commitPriceList.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => save())).toBe("/login");
  });
});
