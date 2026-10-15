import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
const apiUploadRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiUploadRequest: (...a: unknown[]) => apiUploadRequest(...a) }));

import {
  approveMaterialQuote, draftMaterialQuote, getMaterialItem, getMaterialPolicy, getMaterialQuote, getMaterialQuoteText, listMaterialItems, listMaterialQuotes, orderFromMaterialQuote, parseCalc, parseItem, parseItemList,
  parseOrderCreated, parsePolicy, parsePreview, parseQuoteDetail, previewMaterialQuote, putMaterialItem, rejectMaterialQuote, removeMaterialPhoto, reorderMaterialPhotos, saveMaterialPolicy, uploadMaterialPhoto,
} from "./materials";
import { CALC_JSON, DRAFT_JSON, ITEM, ITEM_BARE_JSON, ITEM_JSON, LIST_JSON, ORDER, ORDER_CREATED_JSON, ORDER_CREDIT_JSON, PHOTO, POLICY_JSON, POLICY_VERSION, PREVIEW_JSON, QUOTE, QUOTE_DETAIL_JSON, QUOTE_LIST_JSON, REJECTED_CALC_JSON, REQUIREMENT, SITE, TEXT_JSON } from "./materials-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
const base = `/v1/tenants/${T}/materials`;
beforeEach(() => vi.clearAllMocks());

describe("a product as the API sends it", () => {
  it("reads every figure the screens use", () => {
    expect(parseItem(ITEM_JSON)).toMatchObject({ id: ITEM, sell_unit: "sq_ft", area_unit: "sq_ft", price_paise: 6500, price_text: "₹65 per sq ft", inputs: { gst_bps: 1800, hsn: "68101990", pieces_per_area_x1000: 4500, pieces_per_pallet: 500, lead_days: 3 } });
    expect(parseItem(ITEM_JSON).photos[0].thumb_url).toMatch(/^https:/);
  });
  it("a product with nothing set says what is missing", () => {
    expect(parseItem(ITEM_BARE_JSON)).toMatchObject({ price_paise: null, area_unit: null, active: false, inputs: { missing_for_quantity: ["price", "gst_rate"] } });
  });
  it.each([["sell_unit", "bucket"], ["stock_status", "plenty"], ["area_unit", "acres"], ["price_paise", -1], ["price_paise", 1.5], ["name", ""], ["id", "x"], ["active", "yes"], ["photos", "none"], ["inputs", null]])("a product with %s = %j is a contract error", (key, value) => {
    expect(() => parseItem({ ...ITEM_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a picture link must be http or https", () => {
    expect(() => parseItem({ ...ITEM_JSON, photos: [{ ...ITEM_JSON.photos[0], url: "javascript:alert(1)" }] })).toThrow(ApiContractError);
    expect(() => parseItem({ ...ITEM_JSON, photos: [{ ...ITEM_JSON.photos[0], thumb_url: "data:text/html,x" }] })).toThrow(ApiContractError);
  });
  it("reads a page of summaries", () => {
    const page = parseItemList(LIST_JSON);
    expect(page.items.map((i) => i.cover?.id ?? null)).toEqual([PHOTO, null]);
    expect(() => parseItemList({ items: "no", next_cursor: null })).toThrow(ApiContractError);
  });
});

describe("the owner's rules", () => {
  it("reads the policy in force and the versions", () => {
    const p = parsePolicy(POLICY_JSON);
    expect(p.current).toMatchObject({ version_no: 2, policy: { default_wastage_bps: 500, advance_bps: 5000, transport: { kind: "per_trip", truck_capacity: 2500, rate_per_trip_paise: 350000 } } });
    expect(p.versions).toHaveLength(2);
    expect(parsePolicy({ current: null, versions: [] }).current).toBeNull();
  });
  it("refuses a rule outside the bounds", () => {
    const bad = (o: object) => ({ ...POLICY_JSON, current: { ...POLICY_JSON.current, policy: { ...POLICY_JSON.current.policy, ...o } } });
    expect(() => parsePolicy(bad({ default_wastage_bps: 20000 }))).toThrow(ApiContractError);
    expect(() => parsePolicy(bad({ transport: { kind: "teleport" } }))).toThrow(ApiContractError);
    expect(() => parsePolicy(bad({ laying: { rate_paise_per_area: -1, gst_bps: 1800 } }))).toThrow(ApiContractError);
  });
});

describe("a quote as the API sends it", () => {
  it("reads the detail with the working", () => {
    const q = parseQuoteDetail(QUOTE_DETAIL_JSON);
    expect(q).toMatchObject({ quote_no: 12, status: "draft", total_paise: 8879500, advance_paise: 4439750, trips: 2, lines: [{ pieces: 4725, pallets: 10 }] });
    expect(q.trace.map((t) => t.rule_id)).toContain("transport.per_trip");
  });
  it.each([["status", "sent"], ["total_paise", -5], ["quote_no", 0], ["reject_code", "rude"], ["flags", "x"], ["lines", null], ["valid_until", 5]])("a quote with %s = %j is a contract error", (key, value) => {
    expect(() => parseQuoteDetail({ ...QUOTE_DETAIL_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("reads the calculator's answer, and a rejection that has no figures", () => {
    expect(parseCalc(CALC_JSON)).toMatchObject({ status: "draft", trips: 2, totals: { total: 8879500 }, range: { total_low: 8496000, total_high: 8879500 } });
    expect(parseCalc(REJECTED_CALC_JSON)).toMatchObject({ status: "rejected", codes: ["LAYING_RATE_MISSING"] });
    expect(parseCalc(REJECTED_CALC_JSON).totals).toBeUndefined();
    expect(() => parseCalc({ ...CALC_JSON, status: "maybe" })).toThrow(ApiContractError);
    expect(() => parseCalc({ ...CALC_JSON, totals: { ...CALC_JSON.totals, total: "1" } })).toThrow(ApiContractError);
  });
  it("reads a preview and an order with a credit warning", () => {
    expect(parsePreview(PREVIEW_JSON)).toMatchObject({ database_agrees: true, valid_until: "2026-10-21" });
    expect(parseOrderCreated(ORDER_CREATED_JSON)).toMatchObject({ order_no: 7, credit: null });
    expect(parseOrderCreated(ORDER_CREDIT_JSON).credit).toMatchObject({ exceeded: true, would_be_paise: 11879500 });
    expect(() => parseOrderCreated({ ...ORDER_CREATED_JSON, order_no: 0 })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("lists and reads products", async () => {
    apiRequest.mockResolvedValueOnce(LIST_JSON).mockResolvedValueOnce(ITEM_JSON);
    await listMaterialItems("tok", T, { inStock: true, includeInactive: true, after: "abc", limit: 10 });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/items?limit=10&in_stock=true&include_inactive=true&after=abc`, "tok");
    await getMaterialItem("tok", T, ITEM);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/items/${ITEM}`, "tok");
    await expect(getMaterialItem("tok", T, "nope")).rejects.toThrow(ApiContractError);
  });
  it("saves a product: the price only when it is given", async () => {
    apiRequest.mockResolvedValue({ item: ITEM_JSON, created: true });
    const input = { name: "Paver", sellUnit: "sq_ft" as const, areaUnit: "sq_ft" as const, stockStatus: "in_stock" as const, active: true };
    await putMaterialItem("tok", T, ITEM, input);
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ name: "Paver", sell_unit: "sq_ft", area_unit: "sq_ft", stock_status: "in_stock", active: true });
    await putMaterialItem("tok", T, ITEM, { ...input, price: { paise: 6500 } });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body).price_paise).toBe(6500);
    await putMaterialItem("tok", T, ITEM, { ...input, price: { clear: true } });
    expect(JSON.parse(apiRequest.mock.calls[2][2].body).price_paise).toBeNull();
    expect(apiRequest.mock.calls[0][2].method).toBe("PUT");
  });
  it("uploads a photo as the raw body, refuses another type, removes and orders photos", async () => {
    apiUploadRequest.mockResolvedValue({ photo: ITEM_JSON.photos[0], replayed: false, item: ITEM_JSON });
    await uploadMaterialPhoto("tok", T, ITEM, PHOTO, new Blob(["x"]), "image/jpeg");
    expect(apiUploadRequest.mock.calls[0][0]).toBe(`${base}/items/${ITEM}/photos?photo_id=${PHOTO}`);
    await expect(uploadMaterialPhoto("tok", T, ITEM, PHOTO, new Blob(["x"]), "image/gif")).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValue(ITEM_JSON);
    await removeMaterialPhoto("tok", T, PHOTO);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/photos/${PHOTO}/remove`, "tok", { method: "POST" });
    await reorderMaterialPhotos("tok", T, ITEM, [PHOTO]);
    expect(JSON.parse(apiRequest.mock.calls.at(-1)![2].body)).toEqual({ photo_ids: [PHOTO] });
  });
  it("reads and saves the rules", async () => {
    apiRequest.mockResolvedValueOnce(POLICY_JSON);
    await getMaterialPolicy("tok", T);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/policy`, "tok");
    apiRequest.mockResolvedValueOnce({ version_id: POLICY_VERSION, version_no: 3, effective_from: "2026-10-14", replayed: false });
    const out = await saveMaterialPolicy("tok", T, POLICY_VERSION, { advance_bps: 3000 });
    expect(out.version_no).toBe(3);
    expect(JSON.parse(apiRequest.mock.calls.at(-1)![2].body)).toEqual({ version_id: POLICY_VERSION, policy: { advance_bps: 3000 } });
  });
  it("previews and drafts with the picks and the site", async () => {
    apiRequest.mockResolvedValueOnce(PREVIEW_JSON).mockResolvedValueOnce(DRAFT_JSON);
    await previewMaterialQuote("tok", T, REQUIREMENT, [{ line_no: 1, item_id: ITEM }], SITE);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/requirements/${REQUIREMENT}/preview`);
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ picks: [{ line_no: 1, item_id: ITEM }], site_id: SITE });
    const d = await draftMaterialQuote("tok", T, REQUIREMENT, QUOTE, [{ line_no: 1, item_id: ITEM }]);
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toEqual({ quote_id: QUOTE, picks: [{ line_no: 1, item_id: ITEM }] });
    expect(d.quote.id).toBe(QUOTE);
    await expect(previewMaterialQuote("tok", T, REQUIREMENT, [{ line_no: 1, item_id: "bad" }])).rejects.toThrow(ApiContractError);
  });
  it("lists, reads, approves, turns down and orders a quote", async () => {
    apiRequest.mockResolvedValueOnce(QUOTE_LIST_JSON).mockResolvedValueOnce(QUOTE_DETAIL_JSON).mockResolvedValueOnce(TEXT_JSON).mockResolvedValueOnce({ ...QUOTE_DETAIL_JSON, status: "approved" }).mockResolvedValueOnce({ ...QUOTE_DETAIL_JSON, status: "rejected", reject_code: "duplicate" }).mockResolvedValueOnce(ORDER_CREATED_JSON);
    await listMaterialQuotes("tok", T, { requirementId: REQUIREMENT, limit: 5 });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/quotes?limit=5&requirement_id=${REQUIREMENT}`);
    await getMaterialQuote("tok", T, QUOTE);
    expect((await getMaterialQuoteText("tok", T, QUOTE, "te")).language_review).toBe("reviewed");
    expect(apiRequest.mock.calls[2][0]).toBe(`${base}/quotes/${QUOTE}/text?language=te`);
    await approveMaterialQuote("tok", T, QUOTE);
    expect(apiRequest.mock.calls[3]).toEqual([`${base}/quotes/${QUOTE}/approve`, "tok", { method: "POST" }]);
    await rejectMaterialQuote("tok", T, QUOTE, "duplicate");
    expect(JSON.parse(apiRequest.mock.calls[4][2].body)).toEqual({ code: "duplicate" });
    await orderFromMaterialQuote("tok", T, QUOTE, ORDER);
    expect(JSON.parse(apiRequest.mock.calls[5][2].body)).toEqual({ order_id: ORDER });
  });
});
