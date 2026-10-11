import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
const apiUploadRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiUploadRequest: (...a: unknown[]) => apiUploadRequest(...a) }));

import { getCatalogueItem, listCatalogueItems, parseItem, parseItemPage, parsePhoto, pictureUrl, putCatalogueItem, removeCataloguePhoto, reorderCataloguePhotos, uploadCataloguePhoto } from "./catalogue";
import { ITEM_A, NEW_PHOTO, PHOTO_A1, PHOTO_A2, PHOTO_A3, SUMMARIES, itemJson, pageJson, photoJson } from "./catalogue-fixtures";

const TENANT = "22222222-2222-4222-8222-222222222222";
const base = `/v1/tenants/${TENANT}/catalogue`;
beforeEach(() => vi.clearAllMocks());

describe("parsing the catalogue contract", () => {
  it("reads a photo, an item with all its photos and a list row with its cover", () => {
    expect(parsePhoto(photoJson(PHOTO_A1, 1))).toMatchObject({ id: PHOTO_A1, position: 1, width: 640, height: 800, expires_in_seconds: 600 });
    const item = parseItem(itemJson());
    expect(item.photos.map((p) => p.id)).toEqual([PHOTO_A1, PHOTO_A2, PHOTO_A3]);
    expect(item).toMatchObject({ fabric: "kanchi_pattu", colours: ["maroon", "gold"], price_paise: 3_850_000, price_text: "₹38,500.00", active: true });
    const page = parseItemPage(pageJson());
    expect(page.items).toHaveLength(4);
    expect(page.items[0].cover?.thumb_url).toContain("_t.jpg");
    expect(page.next_cursor).toBeNull();
  });

  it("an item with no exact price and no cover is fine; the band is always there", () => {
    const row = parseItemPage(pageJson([SUMMARIES[1]])).items[0];
    expect(row.price_paise).toBeNull();
    expect(row.price_band_label).toBe("₹5,000 to ₹10,000");
    expect(parseItemPage(pageJson([{ ...SUMMARIES[1], cover: null }])).items[0].cover).toBeNull();
  });

  it.each([
    ["an unknown fabric", { fabric: "velvet" }],
    ["a colour outside the palette", { colours: ["teal"] }],
    ["five colours", { colours: ["red", "blue", "green", "pink", "gold"] }],
    ["an unknown price band", { price_band: "free" }],
    ["an unknown stock word", { stock_status: "gone" }],
    ["a price below ₹1", { price_paise: 50 }],
    ["a name that is empty", { name: "  " }],
    ["a non-boolean active", { active: "yes" }],
    ["a bad date", { updated_at: "yesterday" }],
  ])("refuses %s", (_what, over) => {
    expect(() => parseItem(itemJson(over))).toThrow(ApiContractError);
  });

  it("refuses a photo list that is too long, a bad photo and a bad cursor", () => {
    const nine = Array.from({ length: 9 }, (_, i) => photoJson(`0f8a927d-9999-4a99-8a99-00000000000${i}`, 1));
    expect(() => parseItem(itemJson({}, nine))).toThrow(ApiContractError);
    expect(() => parsePhoto(photoJson(PHOTO_A1, 0))).toThrow(ApiContractError);
    expect(() => parsePhoto(photoJson("not-a-uuid", 1))).toThrow(ApiContractError);
    expect(() => parseItemPage({ items: [], next_cursor: "" })).toThrow(ApiContractError);
  });

  it("only an http or https link is a picture: nothing else is ever put in an image", () => {
    expect(pictureUrl(null, "x")).toBeNull();
    expect(pictureUrl("https://a.example/x.jpg?token=1", "x")).toBe("https://a.example/x.jpg?token=1");
    expect(pictureUrl("http://127.0.0.1:54321/storage/v1/x", "x")).toBe("http://127.0.0.1:54321/storage/v1/x");
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "//a.example/x", "not a url", 7, "https://a.example/" + "x".repeat(3000)]) expect(() => pictureUrl(bad, "x")).toThrow(ApiContractError);
    expect(() => parsePhoto(photoJson(PHOTO_A1, 1, { url: "javascript:alert(1)" }))).toThrow(ApiContractError);
  });
});

describe("the requests", () => {
  it("lists with the filters the API has: words joined by commas, in stock, hidden ones, the cursor", async () => {
    apiRequest.mockResolvedValue(pageJson());
    await listCatalogueItems("tok", TENANT, { fabric: "kanchi_pattu", colours: ["maroon", "gold"], occasions: ["wedding"], priceBands: ["5k_10k", "10k_25k"], inStock: true, includeInactive: true, after: "abc", limit: 50 });
    const [path, token] = apiRequest.mock.calls[0];
    expect(token).toBe("tok");
    const q = new URL(`http://x${path}`).searchParams;
    expect(path.startsWith(`${base}/items?`)).toBe(true);
    expect(Object.fromEntries(q)).toEqual({ limit: "50", fabric: "kanchi_pattu", colour: "maroon,gold", occasion: "wedding", price_band: "5k_10k,10k_25k", in_stock: "true", include_inactive: "true", after: "abc" });
  });

  it("asks for a page of 24 and nothing else when there is no filter", async () => {
    apiRequest.mockResolvedValue(pageJson());
    await listCatalogueItems("tok", TENANT);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/items?limit=24`);
  });

  it("reads one item, and refuses an id that is not a uuid before any request", async () => {
    apiRequest.mockResolvedValue(itemJson());
    expect((await getCatalogueItem("tok", TENANT, ITEM_A)).photos).toHaveLength(3);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/items/${ITEM_A}`, "tok");
    await expect(getCatalogueItem("tok", TENANT, "../../x")).rejects.toThrow(ApiContractError);
    await expect(listCatalogueItems("tok", "nope")).rejects.toThrow(ApiContractError);
  });

  const input = { name: "A saree", fabric: "soft_silk" as const, colours: ["blue" as const], zari: "light" as const, border: null, occasions: [], priceBand: "5k_10k" as const, stockStatus: "in_stock" as const, active: false };
  const bodyOf = () => JSON.parse(apiRequest.mock.calls[0][2].body as string) as Record<string, unknown>;

  it("saves the whole item; the exact price is LEFT OUT to keep it, a number to set it, null to clear it", async () => {
    apiRequest.mockResolvedValue({ item: itemJson(), created: true });
    expect(await putCatalogueItem("tok", TENANT, ITEM_A, input)).toMatchObject({ created: true });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/items/${ITEM_A}`);
    expect(apiRequest.mock.calls[0][2].method).toBe("PUT");
    expect(bodyOf()).toEqual({ name: "A saree", fabric: "soft_silk", colours: ["blue"], zari: "light", border: null, occasions: [], price_band: "5k_10k", stock_status: "in_stock", active: false });
    expect("price_paise" in bodyOf()).toBe(false);

    apiRequest.mockClear();
    await putCatalogueItem("tok", TENANT, ITEM_A, { ...input, price: { paise: 3_850_000 } });
    expect(bodyOf().price_paise).toBe(3_850_000);

    apiRequest.mockClear();
    await putCatalogueItem("tok", TENANT, ITEM_A, { ...input, price: { clear: true } });
    expect("price_paise" in bodyOf()).toBe(true);
    expect(bodyOf().price_paise).toBeNull();
  });

  it("uploads the photo as the raw body with its own type and the photo's id", async () => {
    apiUploadRequest.mockResolvedValue({ photo: photoJson(NEW_PHOTO, 4), replayed: false, item: itemJson() });
    const bytes = new ArrayBuffer(8);
    const out = await uploadCataloguePhoto("tok", TENANT, ITEM_A, NEW_PHOTO, bytes, "image/webp");
    expect(apiUploadRequest).toHaveBeenCalledWith(`${base}/items/${ITEM_A}/photos?photo_id=${NEW_PHOTO}`, "tok", bytes, "image/webp");
    expect(out.photo.id).toBe(NEW_PHOTO);
    expect(out.replayed).toBe(false);
    await expect(uploadCataloguePhoto("tok", TENANT, ITEM_A, NEW_PHOTO, bytes, "image/gif")).rejects.toThrow(ApiContractError);
    await expect(uploadCataloguePhoto("tok", TENANT, ITEM_A, "x", bytes, "image/png")).rejects.toThrow(ApiContractError);
  });

  it("removes a photo and puts the photos in order (every id must be a uuid)", async () => {
    apiRequest.mockResolvedValue(itemJson());
    await removeCataloguePhoto("tok", TENANT, PHOTO_A2);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/photos/${PHOTO_A2}/remove`, "tok", { method: "POST" });
    apiRequest.mockClear();
    await reorderCataloguePhotos("tok", TENANT, ITEM_A, [PHOTO_A3, PHOTO_A1, PHOTO_A2]);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/items/${ITEM_A}/photos/order`);
    expect(apiRequest.mock.calls[0][2]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body as string)).toEqual({ photo_ids: [PHOTO_A3, PHOTO_A1, PHOTO_A2] });
    await expect(reorderCataloguePhotos("tok", TENANT, ITEM_A, ["x"])).rejects.toThrow(ApiContractError);
  });
});
