/** Synthetic price list bodies as the API sends them (shared by the price list tests). Nothing here is a real product, price or person. */
export const TENANT = "22222222-2222-2222-2222-222222222222";
export const VERSION = "55555555-5555-4555-8555-555555555555";

export const ITEM_JSON = {
  sku: "SYN-KJ-RED-01", name: "SYNTHETIC Kanjivaram silk saree, red", catalog_name: "SYNTHETIC Kanjivaram silk saree, red", name_matches: true, sale_unit: "piece", unit_price_paise: 420000,
  minimum_order_quantity: 4, tax_bps: 500, breaks: [{ min_qty: 10, unit_price_paise: 400000 }, { min_qty: 50, unit_price_paise: 390000 }],
};
export const ITEM2_JSON = {
  sku: "SYN-PT-SET-01", name: "Set", catalog_name: "SYNTHETIC Paithani silk saree, set of 3", name_matches: false, sale_unit: "set", unit_price_paise: 280050, minimum_order_quantity: 1, tax_bps: 1250, breaks: [],
};
export const PREVIEW_JSON = { ok: true, parser_version: "1.0.0", effective_from: "2026-10-06", row_count: 2, canonical_hash: "ab".repeat(32), items: [ITEM_JSON, ITEM2_JSON], issues: [] };
export const BAD_JSON = {
  ok: false, parser_version: "1.0.0", effective_from: "2026-10-06", row_count: 3, canonical_hash: null, items: [],
  issues: [{ row: 1, column: "sku", code: "INVALID_SKU" }, { row: 3, column: "unit_price", code: "INVALID_MONEY" }, { row: 0, column: null, code: "FILE_LIMIT" }],
};
export const COMMITTED_JSON = { version_id: VERSION, version_no: 2, effective_from: "2026-10-06", item_count: 2, content_sha256: "cd".repeat(32), replayed: false };
