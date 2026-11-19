import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { itemJson } from "@/lib/api/catalogue-fixtures";
import { parseItem } from "@/lib/api/catalogue";
import { EMPTY } from "@/lib/sell/forms";

const T = "22222222-2222-2222-2222-222222222222";
const ITEM = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
const m = vi.hoisted(() => ({ who: vi.fn(), saveItem: vi.fn(), getItem: vi.fn(), putQuantity: vi.fn(), fetchTenant: vi.fn(), pack: vi.fn() }));
vi.mock("../retailers/finder-guard", async (orig) => ({ ...(await orig<typeof import("../retailers/finder-guard")>()), who: m.who }));
vi.mock("../catalogue/catalogue-actions", () => ({ saveItemAction: m.saveItem }));
vi.mock("@/lib/api/catalogue", async (orig) => ({ ...(await orig<typeof import("@/lib/api/catalogue")>()), getCatalogueItem: m.getItem, putQuantity: m.putQuantity }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: m.fetchTenant }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: m.pack }));

import { readSheetAction, saveEntryAction, understandAction } from "./actions";

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
    it("a business with no catalogue (or a style with no API yet) is told it is not ready, and nothing is sent", async () => {
      m.pack.mockResolvedValue({ modules: ["materials"] });
      expect(await saveEntryAction(T, "products", null, products)).toMatchObject({ ok: false, kind: "unavailable" });
      m.pack.mockResolvedValue({ modules: ["catalogue"] });
      expect(await saveEntryAction(T, "services", null, { ...EMPTY.services, name: "Facial", price: "700" })).toMatchObject({ ok: false, kind: "unavailable" });
      expect(m.saveItem).not.toHaveBeenCalled();
    });
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
