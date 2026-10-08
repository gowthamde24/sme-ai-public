import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT, TYPE_A_JSON, TYPE_B_JSON } from "@/lib/api/quotes-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = { fetchItemTypes: vi.fn(), saveItemType: vi.fn() };
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/item-types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/item-types")>()),
  fetchItemTypes: (...a: unknown[]) => api.fetchItemTypes(...a),
  saveItemType: (...a: unknown[]) => api.saveItemType(...a),
}));

import { parseItemTypes } from "@/lib/api/item-types";

import { addItemTypeAction, saveItemTypeAction } from "./item-types-actions";
import { TEXT } from "./item-types-logic";

const CANARY = "CANARY-9a8b7c";
const PAGE = `/app/tenants/${TENANT}/item-types`;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const NEW = { name: "Type D", code: "D", position: "4", lowest: "100", highest: "900.50" };
const add = (over: Record<string, string> = {}) => addItemTypeAction(TENANT, undefined, form({ ...NEW, ...over }));
const edit = (code: string, over: Record<string, string> = {}) => saveItemTypeAction(TENANT, code, undefined, form({ name: "Type A", position: "1", active: "on", lowest: "", highest: "", ...over }));
const refused = (status: number, code: string) => new ApiRequestError(status, code, `${CANARY} secret`);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.fetchItemTypes.mockResolvedValue(parseItemTypes([TYPE_A_JSON, TYPE_B_JSON]));
  api.saveItemType.mockResolvedValue({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", code: "D", created: true });
});

describe("addItemTypeAction", () => {
  it("authenticates first, reads the prices into integer paise, adds it switched on and says so", async () => {
    expect(await add()).toEqual({ ok: true, message: "Added." });
    expect(requireUser).toHaveBeenCalled();
    expect(api.saveItemType).toHaveBeenCalledWith("tok", TENANT, { code: "D", name: "Type D", position: 4, active: true, minPricePaise: 10_000, maxPricePaise: 90_050 });
    expect(revalidatePath).toHaveBeenCalledWith(PAGE);
  });
  it("no price means no bound", async () => {
    await add({ lowest: "", highest: "" });
    expect(api.saveItemType.mock.calls[0][2]).toMatchObject({ minPricePaise: null, maxPricePaise: null });
  });
  it("a code that already exists is refused BEFORE the save, because the API call would replace that record", async () => {
    expect(await add({ code: "A" })).toEqual({ ok: false, error: TEXT.exists });
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
  it("a code that is added by someone else in the meantime is said plainly (the API replaced it)", async () => {
    api.saveItemType.mockResolvedValue({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", code: "D", created: false });
    const r = await add();
    expect(r).toMatchObject({ ok: true });
    expect(r?.message).toMatch(/just been added by someone else/);
  });
  it("reads only its own fields: a tenant, a price in paise, an id or an active flag of the form's is not believed", async () => {
    await add({ tenant_id: "x", min_price_paise: "1", id: "y", active: "off", position_x: "9" });
    expect(api.saveItemType.mock.calls[0][2]).toEqual({ code: "D", name: "Type D", position: 4, active: true, minPricePaise: 10_000, maxPricePaise: 90_050 });
  });
  it.each([
    [{ name: "" }, /Name:/],
    [{ code: "a b" }, /Code:/],
    [{ code: "" }, /Code:/],
    [{ position: "" }, /Order:/],
    [{ position: "-1" }, /Order:/],
    [{ lowest: "1.505" }, /Lowest price:/],
    [{ highest: "abc" }, /Highest price:/],
    [{ lowest: "900", highest: "100" }, /must not be above/],
  ])("refuses %j with a sentence of ours before any request", async (over, pattern) => {
    const r = await add(over as Record<string, string>);
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(pattern);
    expect(api.fetchItemTypes).not.toHaveBeenCalled();
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
  it("a tenant id that is not a canonical UUID is not available", async () => {
    expect(await addItemTypeAction("x", undefined, form(NEW))).toEqual({ ok: false, error: "This workspace is not available." });
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
  it("an expired session goes to the login page, on the read and on the save", async () => {
    api.fetchItemTypes.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => add())).toBe("/login");
    api.fetchItemTypes.mockResolvedValue(parseItemTypes([TYPE_A_JSON]));
    api.saveItemType.mockRejectedValue(new ApiAuthError("expired"));
    expect(await redirectTarget(() => add())).toBe("/login");
  });
});

describe("saveItemTypeAction", () => {
  it("replaces the type under the code the PAGE bound, with the typed fields, and says saved", async () => {
    expect(await edit("A", { name: "Type A (new name)", position: "3", lowest: "10", highest: "20", active: "" })).toEqual({ ok: true, message: "Saved." });
    expect(api.saveItemType).toHaveBeenCalledWith("tok", TENANT, { code: "A", name: "Type A (new name)", position: 3, active: false, minPricePaise: 1000, maxPricePaise: 2000 });
  });
  it("the tick box on means active, absent means switched off", async () => {
    await edit("A", { active: "on" });
    await edit("A", {});
    const calls = api.saveItemType.mock.calls.map((c) => (c[2] as { active: boolean }).active);
    expect(calls).toEqual([true, true]);
    api.saveItemType.mockClear();
    await saveItemTypeAction(TENANT, "A", undefined, form({ name: "Type A", position: "1", lowest: "", highest: "" }));
    expect((api.saveItemType.mock.calls[0][2] as { active: boolean }).active).toBe(false);
  });
  it("the code never comes from the form: a code field in the form is ignored", async () => {
    await edit("A", { code: "ZZ" });
    expect((api.saveItemType.mock.calls[0][2] as { code: string }).code).toBe("A");
  });
  it("a code that is not in the list is refused (an edit never creates a type)", async () => {
    expect(await edit("Q")).toEqual({ ok: false, error: TEXT.unknown });
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
  it("refuses a bad field with a sentence of ours before any request", async () => {
    expect((await edit("A", { lowest: "9", highest: "1" }))?.error).toMatch(/must not be above/);
    expect((await edit("A", { name: "  " }))?.error).toMatch(/Name:/);
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
});

describe("every refusal from the API is a fixed sentence of ours", () => {
  const cases: [number, string, RegExp, boolean][] = [
    [403, "mfa_required", /authenticator app/, true],
    [403, "forbidden", /Only an owner or an admin/, false],
    [422, "validation_error", /not accepted/, false],
    [422, "invalid_value", /above the highest/, false],
    [404, "not_found", /not available/, false],
    [503, "quotes_unavailable", /not available right now/, false],
    [500, "weird", /Could not save/, false],
  ];
  it.each(cases)("%i %s", async (status, code, pattern, mfa) => {
    api.saveItemType.mockRejectedValue(refused(status, code));
    const r = await add();
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(pattern);
    expect(r?.reason === "mfa").toBe(mfa);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    const e = await edit("A");
    expect(JSON.stringify(e)).not.toContain(CANARY);
  });
  it("a refusal while reading the list for the check is also a fixed sentence", async () => {
    api.fetchItemTypes.mockRejectedValue(refused(503, "quotes_unavailable"));
    const r = await add();
    expect(r?.error).toMatch(/not available right now/);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(api.saveItemType).not.toHaveBeenCalled();
  });
});
