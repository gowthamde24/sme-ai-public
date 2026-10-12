import { parseItemSummary } from "./catalogue";

/**
 * Invented answers in the shape of the catalogue contract (job AY report, "Web contract"), for tests and the screenshot pages. Twelve-ish sarees of a pretend shop; the "photos" are links on a made-up
 * address that nothing serves (the tests never load them). Names, ids and prices are invented; the exact price is shown on one item only, as the Owner sets it.
 */
export const ITEM_A = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
export const ITEM_B = "5a1c0d62-3b2e-4a8e-9e31-0c7d4e5f6a01";
export const ITEM_C = "8e7f6d5c-4b3a-4291-a0b1-c2d3e4f5a602";
export const ITEM_HIDDEN = "1f2e3d4c-5b6a-4798-8695-a4b3c2d1e003";
export const PHOTO_A1 = "0f8a927d-1111-4a11-8a11-000000000001";
export const PHOTO_A2 = "0f8a927d-1111-4a11-8a11-000000000002";
export const PHOTO_A3 = "0f8a927d-1111-4a11-8a11-000000000003";
export const PHOTO_B1 = "0f8a927d-2222-4a22-8a22-000000000001";
export const PHOTO_C1 = "0f8a927d-3333-4a33-8a33-000000000001";
export const NEW_PHOTO = "0f8a927d-4444-4a44-8a44-000000000001";
export const LEAD_FOUND = "c5c78ed6-e536-46af-a5c3-872bb2d844a2";

const HOST = "https://storage.example.test/storage/v1/object/sign/cat-demo";

export function photoJson(id: string, position: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, position, url: `${HOST}/${id}.jpg?token=t${position}`, thumb_url: `${HOST}/${id}_t.jpg?token=t${position}`, width: 640, height: 800, bytes: 87_471, expires_in_seconds: 600, ...over };
}

const base = {
  zari: "light",
  border: null,
  occasions: [],
  price_paise: null,
  price_text: null,
  active: true,
  created_at: "2026-10-05T09:00:00Z",
  updated_at: "2026-10-05T09:30:00Z",
};

export function itemJson(over: Record<string, unknown> = {}, photos: Record<string, unknown>[] = [photoJson(PHOTO_A1, 1), photoJson(PHOTO_A2, 2), photoJson(PHOTO_A3, 3)]): Record<string, unknown> {
  return {
    ...base,
    id: ITEM_A,
    name: "DEMO Maroon Kanchi pattu",
    fabric: "kanchi_pattu",
    fabric_label: "Kanchi pattu",
    colours: ["maroon", "gold"],
    zari: "rich",
    border: "Temple border in gold zari",
    occasions: ["festival", "wedding"],
    price_band: "25k_50k",
    price_band_label: "₹25,000 to ₹50,000",
    price_paise: 3_850_000,
    price_text: "₹38,500.00",
    stock_status: "in_stock",
    stock_label: "In stock",
    photo_count: photos.length,
    photos,
    ...over,
  };
}

/** A list row: the same fields with the cover only. */
export function summaryJson(over: Record<string, unknown> = {}, cover: Record<string, unknown> | null = photoJson(PHOTO_A1, 1)): Record<string, unknown> {
  const { photos: _photos, ...row } = itemJson(over, cover ? [cover] : []);
  void _photos;
  return { ...row, photo_count: over.photo_count ?? (cover ? 3 : 0), cover };
}

export const SUMMARIES: Record<string, unknown>[] = [
  summaryJson(),
  summaryJson({ id: ITEM_B, name: "DEMO Soft silk in peacock blue", border: "Peacock motif border", fabric: "soft_silk", fabric_label: "Soft silk", colours: ["blue"], zari: "light", occasions: ["party"], price_band: "5k_10k", price_band_label: "₹5,000 to ₹10,000", price_paise: null, price_text: null, stock_status: "few_left", stock_label: "Few left" }, photoJson(PHOTO_B1, 1)),
  summaryJson({ id: ITEM_C, name: "DEMO Georgette in blush pink", fabric: "georgette", fabric_label: "Georgette", colours: ["pink"], zari: "none", border: null, occasions: ["daily"], price_band: "under_5k", price_band_label: "under ₹5,000", price_paise: null, price_text: null, stock_status: "made_to_order", stock_label: "Made to order" }, photoJson(PHOTO_C1, 1)),
  summaryJson({ id: ITEM_HIDDEN, name: "DEMO Old Banarasi (hidden)", border: "Plain woven border", fabric: "banarasi", fabric_label: "Banarasi", colours: ["red"], price_band: "above_50k", price_band_label: "above ₹50,000", price_paise: null, price_text: null, active: false, stock_status: "in_stock", stock_label: "In stock" }, photoJson("0f8a927d-5555-4a55-8a55-000000000001", 1)),
];

export const pageJson = (items: Record<string, unknown>[] = SUMMARIES, next: string | null = null) => ({ items, next_cursor: next });
export const parseSummary = parseItemSummary;
