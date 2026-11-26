import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { itemJson } from "@/lib/api/catalogue-fixtures";
import { parseItem } from "@/lib/api/catalogue";
import { ApiRequestError } from "@/lib/api/client";
import { EMPTY } from "@/lib/sell/forms";

const T = "22222222-2222-2222-2222-222222222222";
const ITEM = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
const FRESH = "5e110002-0000-4000-8000-0000000000f1";
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const m = vi.hoisted(() => ({ who: vi.fn(), saveItem: vi.fn(), getItem: vi.fn(), putQuantity: vi.fn(), fetchTenant: vi.fn(), pack: vi.fn(), put: vi.fn(), remove: vi.fn(), read: vi.fn(), readProducts: vi.fn() }));
vi.mock("../retailers/finder-guard", async (orig) => ({ ...(await orig<typeof import("../retailers/finder-guard")>()), who: m.who }));
vi.mock("../catalogue/catalogue-actions", () => ({ saveItemAction: m.saveItem }));
vi.mock("@/lib/api/catalogue", async (orig) => ({ ...(await orig<typeof import("@/lib/api/catalogue")>()), getCatalogueItem: m.getItem, putQuantity: m.putQuantity }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: m.fetchTenant }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: m.pack }));
vi.mock("@/lib/api/what-you-sell", async (orig) => ({ ...(await orig<typeof import("@/lib/api/what-you-sell")>()), putSellEntry: m.put, removeSellEntry: m.remove, readSellDrafts: m.read, readProductDrafts: m.readProducts }));

import { readAction, readProductsAction, readSheetAction, removeEntryAction, saveEntryAction, understandAction } from "./actions";

const products = { ...EMPTY.products, name: "Red silk", price: "9,000", colours: ["red" as const], stock: "few_left" as const, count: "2" };
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.who.mockResolvedValue({ token: "tok", t: appT("en") });
  m.fetchTenant.mockResolvedValue({ role: "owner" });
  m.pack.mockResolvedValue({ modules: ["catalogue", "quotes"] });
});
afterEach(() => vi.unstubAllEnvs());

describe("saving one entry", () => {
  it("JOBS off: nothing is saved", async () => {
    expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: false, kind: "invalid" });
    expect(m.saveItem).not.toHaveBeenCalled();
  });
  it("JOBS off: nothing is called by any of the three actions (not the guard, the pack, the catalogue)", async () => {
    expect(await understandAction(T, "products", "red silk saree")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await readSheetAction(T, "products", "sheet")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: false, kind: "invalid" });
    for (const f of Object.values(m)) expect(f).not.toHaveBeenCalled();
  });
  it("a refusal of the guard (a role that only reads) is passed on as it is", async () => {
    vi.stubEnv("JOBS", "mock");
    m.who.mockResolvedValueOnce({ ok: false, kind: "forbidden", error: "no" });
    expect(await saveEntryAction(T, "products", null, products)).toEqual({ ok: false, kind: "forbidden", error: "no" });
  });
  it("JOBS=mock: the form is checked and answered, and nothing is stored or sent", async () => {
    vi.stubEnv("JOBS", "mock");
    const ok = await saveEntryAction(T, "services", null, { ...EMPTY.services, name: "Facial", price: "700" });
    expect(ok).toMatchObject({ ok: true, data: { entry: { style: "services", name: "Facial", pricePaise: 70_000 }, photosPath: null } });
    const bad = await saveEntryAction(T, "services", null, { ...EMPTY.services, name: "" });
    expect(bad).toMatchObject({ ok: false, kind: "invalid", fields: ["name"], error: "Please write a name." });
    expect(m.saveItem).not.toHaveBeenCalled();
    expect(m.putQuantity).not.toHaveBeenCalled();
  });
  it("a style or an id that is not ours is refused", async () => {
    vi.stubEnv("JOBS", "mock");
    expect(await saveEntryAction(T, "rentals" as never, null, products)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await saveEntryAction(T, "products", "not-an-id", products)).toMatchObject({ ok: false, kind: "invalid" });
  });

  describe("a product of a real saree shop is the OLD catalogue form's save", () => {
    beforeEach(() => vi.stubEnv("JOBS", "1"));
    it("new: the same payload through the same action, the count through the stock call, the photos offered next", async () => {
      m.saveItem.mockImplementation(async (_t: string, id: string) => ({ ok: true, item: parseItem(itemJson({ id, name: "Red silk" }, [])) }));
      m.putQuantity.mockResolvedValue(undefined);
      const r = await saveEntryAction(T, "products", null, products);
      expect(m.saveItem).toHaveBeenCalledTimes(1);
      const [tenant, id, input] = m.saveItem.mock.calls[0];
      expect(tenant).toBe(T);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(input).toEqual({ name: "Red silk", fabric: "kanchi_pattu", colours: ["red"], zari: "none", border: null, occasions: [], priceBand: "5k_10k", stockStatus: "few_left", active: false, price: { rupees: 9000 } });
      expect(m.putQuantity).toHaveBeenCalledWith("tok", T, id, 2);
      expect(r).toMatchObject({ ok: true, data: { photosPath: `/catalogue/${id}`, note: null, entry: { name: "Red silk", stock: { state: "few_left", count: 2 } } } });
    });
    it("an Admin never sends the exact price (the old form's rule), only the band", async () => {
      m.fetchTenant.mockResolvedValue({ role: "admin" });
      m.saveItem.mockImplementation(async (_t: string, id: string) => ({ ok: true, item: parseItem(itemJson({ id })) }));
      await saveEntryAction(T, "products", null, products);
      expect(m.saveItem.mock.calls[0][2]).not.toHaveProperty("price");
      expect(m.saveItem.mock.calls[0][2].priceBand).toBe("5k_10k");
    });
    it("changed: the item is read first and what the sheet does not ask goes back as it was", async () => {
      m.getItem.mockResolvedValue(parseItem(itemJson()));
      m.saveItem.mockImplementation(async (_t: string, id: string) => ({ ok: true, item: parseItem(itemJson({ id })) }));
      const r = await saveEntryAction(T, "products", ITEM, { ...products, name: "Maroon Kanchi", price: "", count: "" });
      expect(m.getItem).toHaveBeenCalledWith("tok", T, ITEM);
      expect(m.saveItem.mock.calls[0][2]).toEqual({ name: "Maroon Kanchi", fabric: "kanchi_pattu", colours: ["red"], zari: "rich", border: "Temple border in gold zari", occasions: ["festival", "wedding"], priceBand: "25k_50k", stockStatus: "few_left", active: true });
      expect(m.putQuantity).not.toHaveBeenCalled();
      expect(r).toMatchObject({ ok: true, data: { photosPath: null } });
    });
    it("the old form's refusals come back as they are: the second step missing is `mfa`", async () => {
      m.saveItem.mockResolvedValue({ ok: false, error: "Saving needs your two-step code first.", mfa: true });
      expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: false, kind: "mfa", mfa: true, error: "Saving needs your two-step code first." });
      expect(m.putQuantity).not.toHaveBeenCalled();
    });
    it("a count that could not be saved is said, the saree is saved", async () => {
      m.saveItem.mockImplementation(async (_t: string, id: string) => ({ ok: true, item: parseItem(itemJson({ id }, [])) }));
      m.putQuantity.mockRejectedValue(new Error("down"));
      expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: true, data: { note: "count" } });
    });
    it("a business with no catalogue is told it is not ready, and nothing is sent", async () => {
      m.pack.mockResolvedValue({ modules: ["materials"] });
      expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: false, kind: "unavailable" });
      expect(m.saveItem).not.toHaveBeenCalled();
    });
    it("the sheet's own id for a NEW product is the id the catalogue gets (a retry is the same item)", async () => {
      m.saveItem.mockImplementation(async (_t: string, id: string) => ({ ok: true, item: parseItem(itemJson({ id }, [])) }));
      m.putQuantity.mockResolvedValue(undefined);
      await saveEntryAction(T, "products", null, products, { freshId: FRESH });
      expect(m.saveItem.mock.calls[0][1]).toBe(FRESH);
    });
  });

  describe("the other four styles are PUT /what-you-sell/{style}/{id} (C1 contract 1.1 part 1)", () => {
    const service = { ...EMPTY.services, name: "Facial", price: "700" };
    beforeEach(() => vi.stubEnv("JOBS", "1"));
    it("a new entry is sent with the id the sheet minted (the same id again is a retry); nothing touches the catalogue", async () => {
      m.put.mockImplementation(async (_tok: string, _t: string, entry: unknown) => entry);
      const r = await saveEntryAction(T, "services", null, service, { freshId: FRESH });
      expect(m.put).toHaveBeenCalledWith("tok", T, expect.objectContaining({ style: "services", id: FRESH, name: "Facial", pricePaise: 70_000 }));
      expect(r).toMatchObject({ ok: true, data: { entry: { id: FRESH }, photosPath: null, note: null } });
      await saveEntryAction(T, "services", null, service, { freshId: FRESH });
      expect(m.put.mock.calls[1][2].id).toBe(FRESH);
      expect(m.saveItem).not.toHaveBeenCalled();
    });
    it("a changed entry keeps its own id; an id that is not a UUID is refused before anything is sent", async () => {
      m.put.mockImplementation(async (_tok: string, _t: string, entry: unknown) => entry);
      await saveEntryAction(T, "services", ITEM, service, { freshId: FRESH });
      expect(m.put.mock.calls[0][2].id).toBe(ITEM);
      expect(await saveEntryAction(T, "services", "nope", service)).toMatchObject({ ok: false, kind: "invalid" });
      expect(m.put).toHaveBeenCalledTimes(1);
    });
    it("a form that is not valid is refused here with the field, nothing is sent", async () => {
      expect(await saveEntryAction(T, "services", null, { ...service, price: "" }, { freshId: FRESH })).toMatchObject({ ok: false, kind: "invalid", fields: ["price"] });
      expect(m.put).not.toHaveBeenCalled();
    });
    it("a course keeps the owner's seats count when the total did not change, and a bad hint is ignored", async () => {
      m.put.mockImplementation(async (_tok: string, _t: string, entry: unknown) => entry);
      const form = { ...EMPTY.courses, name: "NEET", batch: "Mon 6 pm", fee: "24000", seats: "30" };
      await saveEntryAction(T, "courses", ITEM, form, { course: { seats: { state: "left", count: 6 }, total: 30 } });
      expect(m.put.mock.calls[0][2]).toMatchObject({ seats: { state: "left", count: 6 }, total: 30 });
      await saveEntryAction(T, "courses", ITEM, form, { course: { seats: { state: "plenty", count: 6 }, total: 30 } as never });
      expect(m.put.mock.calls[1][2]).toMatchObject({ seats: { state: "left", count: 30 } });
    });
    it("ONLY a 404 is 'not ready'; the second step missing is `mfa` with the Security path; a real refusal is shown as it is", async () => {
      m.put.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no"));
      expect(await saveEntryAction(T, "services", null, service, { freshId: FRESH })).toMatchObject({ ok: false, kind: "unavailable", error: "This is not ready for your kind of business yet. Your assistant still answers from what you tell it." });
      m.put.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "no"));
      expect(await saveEntryAction(T, "services", null, service, { freshId: FRESH })).toMatchObject({ ok: false, kind: "mfa", mfa: true });
      m.put.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "no"));
      expect(await saveEntryAction(T, "services", null, service, { freshId: FRESH })).toMatchObject({ ok: false, kind: "forbidden" });
      m.put.mockRejectedValueOnce(new ApiRequestError(422, "setting_invalid", "no", undefined, undefined, undefined, { fields: ["price_paise"] }));
      expect(await saveEntryAction(T, "services", null, service, { freshId: FRESH })).toMatchObject({ ok: false, kind: "invalid", fields: ["price_paise"] });
      m.put.mockRejectedValueOnce(new ApiRequestError(503, "down", "no"));
      expect(await saveEntryAction(T, "services", null, service, { freshId: FRESH })).toMatchObject({ ok: false, kind: "unavailable" });
    });
  });
});

describe("removing an entry", () => {
  it("JOBS off: nothing happens; mock: ok and nothing sent; products are never removed here", async () => {
    expect(await removeEntryAction(T, "services", ITEM)).toMatchObject({ ok: false, kind: "invalid" });
    vi.stubEnv("JOBS", "mock");
    expect(await removeEntryAction(T, "services", ITEM)).toEqual({ ok: true, data: { id: ITEM } });
    expect(await removeEntryAction(T, "products", ITEM)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await removeEntryAction(T, "services", "nope")).toMatchObject({ ok: false, kind: "invalid" });
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("a real workspace: POST remove; a 404 is 'not ready', a refusal is shown as it is", async () => {
    vi.stubEnv("JOBS", "1");
    m.remove.mockResolvedValueOnce(undefined);
    expect(await removeEntryAction(T, "pricelist", ITEM)).toEqual({ ok: true, data: { id: ITEM } });
    expect(m.remove).toHaveBeenCalledWith("tok", T, "pricelist", ITEM);
    m.remove.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no"));
    expect(await removeEntryAction(T, "pricelist", ITEM)).toMatchObject({ ok: false, kind: "unavailable" });
    m.remove.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "no"));
    expect(await removeEntryAction(T, "pricelist", ITEM)).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("the reading call", () => {
  const out = { entries: [], unclear: false, notes: [] };
  it("JOBS off: nothing is asked; mock: not ready (the closed-word parser and the made-up readings are the mock's)", async () => {
    expect(await readAction(T, "services", { kind: "talk", text: "haircut 200" })).toMatchObject({ ok: false, kind: "invalid" });
    vi.stubEnv("JOBS", "mock");
    expect(await readAction(T, "services", { kind: "talk", text: "haircut 200" })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(m.read).not.toHaveBeenCalled();
  });
  it("a real workspace: talk and file requests are checked, then asked in the language of the screen", async () => {
    vi.stubEnv("JOBS", "1");
    m.read.mockResolvedValue(out);
    expect(await readAction(T, "services", { kind: "talk", text: "  haircut 200  " })).toEqual({ ok: true, data: out });
    expect(m.read).toHaveBeenLastCalledWith("tok", T, "services", { kind: "talk", text: "haircut 200" }, "en");
    expect(await readAction(T, "pricelist", { kind: "photo", fileId: FRESH })).toEqual({ ok: true, data: out });
    expect(m.read).toHaveBeenLastCalledWith("tok", T, "pricelist", { kind: "photo", fileId: FRESH }, "en");
    for (const bad of [{ kind: "talk", text: "hi" }, { kind: "talk", text: "x".repeat(2001) }, { kind: "sheet", fileId: "nope" }, { kind: "video", fileId: FRESH }, null] as never[]) expect(await readAction(T, "services", bad)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await readAction(T, "products", { kind: "talk", text: "red saree" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(m.read).toHaveBeenCalledTimes(2);
  });
  it("404 = not ready; the 30-an-hour limit and any other refusal are shown as they are", async () => {
    vi.stubEnv("JOBS", "1");
    m.read.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "no"));
    expect(await readAction(T, "services", { kind: "talk", text: "haircut 200" })).toMatchObject({ ok: false, kind: "unavailable" });
    m.read.mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "no", undefined, undefined, 60));
    expect(await readAction(T, "services", { kind: "talk", text: "haircut 200" })).toMatchObject({ ok: false, kind: "rate_limited" });
    m.read.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "no"));
    expect(await readAction(T, "services", { kind: "talk", text: "haircut 200" })).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("Say it and the photo/sheet reading", () => {
  it("understanding a sentence needs the screens on and a sentence; it saves nothing", async () => {
    expect(await understandAction(T, "products", "Silk saree, 100 rupees")).toMatchObject({ ok: false });
    vi.stubEnv("JOBS", "mock");
    expect(await understandAction(T, "products", "Silk saree, 100 rupees, red")).toMatchObject({ ok: true, data: { form: { name: "Silk saree", price: "100", colours: ["red"] } } });
    expect(await understandAction(T, "products", "hi")).toMatchObject({ ok: false });
    expect(m.saveItem).not.toHaveBeenCalled();
  });
  it("the made-up reading of photos and sheets is test mode only; a real shop is told it is not ready", async () => {
    vi.stubEnv("JOBS", "1");
    expect(await readSheetAction(T, "products", "photos")).toMatchObject({ ok: false, kind: "unavailable" });
    vi.stubEnv("JOBS", "mock");
    expect(await readSheetAction(T, "products", "photos")).toMatchObject({ ok: true });
    expect(await readSheetAction(T, "products", "scan" as never)).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("the products reading of a photo or a PDF (C1, 26 Nov 2026)", () => {
  const reading = { drafts: [], unclear: false, notes: [], readBy: "ai_vision" as const, pages: 1 };
  it("JOBS off: nothing is asked; a real workspace asks with the file id only, and a bad id never leaves", async () => {
    expect(await readProductsAction(T, FRESH)).toMatchObject({ ok: false, kind: "invalid" });
    vi.stubEnv("JOBS", "1");
    m.readProducts.mockResolvedValue(reading);
    expect(await readProductsAction(T, FRESH)).toEqual({ ok: true, data: reading });
    expect(m.readProducts).toHaveBeenCalledWith("tok", T, FRESH);
    expect(await readProductsAction(T, "nope")).toMatchObject({ ok: false, kind: "invalid" });
    expect(m.readProducts).toHaveBeenCalledTimes(1);
  });
  it("each refusal is one plain sentence of ours: not switched on, HEIC (share as JPG), a scanned school sheet, the day's limit", async () => {
    vi.stubEnv("JOBS", "1");
    const t = appT("en");
    const refuse = async (e: ApiRequestError) => {
      m.readProducts.mockRejectedValueOnce(e);
      return readProductsAction(T, FRESH);
    };
    expect(await refuse(new ApiRequestError(404, "not_found", "no"))).toMatchObject({ ok: false, kind: "unavailable", error: t("jobs.sell.imp.err.no_read") });
    expect(await refuse(new ApiRequestError(422, "file_unreadable", "no", "heic"))).toMatchObject({ ok: false, error: t("jobs.sell.imp.err.heic") });
    expect(t("jobs.sell.imp.err.heic")).toMatch(/JPG/);
    expect(await refuse(new ApiRequestError(422, "validation_error", "no", "scanned_school"))).toMatchObject({ ok: false, error: t("jobs.sell.imp.err.scanned") });
    expect(await refuse(new ApiRequestError(429, "ai_limit", "no"))).toMatchObject({ ok: false, error: t("jobs.sell.imp.err.ai_limit") });
  });
});

