/** Synthetic building-materials answers as the API sends them (job CO; shared by the data-layer, screen and component tests). Nothing here is a real customer, price or person. The figures are the calculator's worked example. */
export const TENANT = "22222222-2222-2222-2222-222222222222";
export const ITEM = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
export const ITEM_BARE = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
export const PHOTO = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
export const QUOTE = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
export const REQUIREMENT = "66666666-6666-4666-8666-666666666666";
export const ENQUIRY = "44444444-4444-4444-4444-444444444444";
export const LEAD = "33333333-3333-3333-3333-333333333333";
export const SITE = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
export const POLICY_VERSION = "9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b";
export const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

export const PHOTO_JSON = { id: PHOTO, position: 1, url: "https://files.example.test/paver-1.jpg?sig=x", thumb_url: "https://files.example.test/paver-1-t.jpg?sig=x", width: 1280, height: 960, bytes: 80_000, expires_in_seconds: 600 };
export const INPUTS_JSON = { price_paise: 6500, gst_bps: 1800, hsn: "68101990", pieces_per_area_x1000: 4500, pieces_per_pallet: 500, min_order_qty: 500, lead_days: 3, missing_for_area: [], missing_for_quantity: [] };
export const ITEM_JSON = {
  id: ITEM, name: "Paver block 80 mm grey (synthetic)", sell_unit: "sq_ft", area_unit: "sq_ft", stock_status: "in_stock", active: true, price_paise: 6500, price_text: "₹65 per sq ft", photo_count: 1,
  photos: [PHOTO_JSON], inputs: INPUTS_JSON, created_at: "2026-10-10T05:00:00+00:00", updated_at: "2026-10-12T05:00:00+00:00",
};
export const ITEM_BARE_JSON = {
  ...ITEM_JSON, id: ITEM_BARE, name: "Kerb stone (synthetic)", sell_unit: "piece", area_unit: null, stock_status: "made_to_order", active: false, price_paise: null, price_text: null, photo_count: 0, photos: [],
  inputs: { price_paise: null, gst_bps: null, hsn: null, pieces_per_area_x1000: null, pieces_per_pallet: null, min_order_qty: null, lead_days: null, missing_for_area: [], missing_for_quantity: ["price", "gst_rate"] },
};
export const SUMMARY_JSON = { id: ITEM, name: ITEM_JSON.name, sell_unit: "sq_ft", area_unit: "sq_ft", stock_status: "in_stock", active: true, price_paise: 6500, price_text: "₹65 per sq ft", photo_count: 1, cover: PHOTO_JSON };
export const SUMMARY_BARE_JSON = { id: ITEM_BARE, name: ITEM_BARE_JSON.name, sell_unit: "piece", area_unit: null, stock_status: "made_to_order", active: false, price_paise: null, price_text: null, photo_count: 0, cover: null };
export const LIST_JSON = { items: [SUMMARY_JSON, SUMMARY_BARE_JSON], next_cursor: null };

export const POLICY_BODY_JSON = {
  default_wastage_bps: 500, round_to_pallet: false, bill_wastage: true, advance_bps: 5000, credit_days: 0, validity_days: 7, rounding_mode: "half_up",
  transport: { kind: "per_trip", capacity_basis: "pieces", truck_capacity: 2500, rate_per_trip_paise: 350000, slabs: null, free_above_paise: null, gst_bps: 1800 },
  handling: null, laying: null,
};
export const POLICY_JSON = {
  current: { version_id: POLICY_VERSION, version_no: 2, effective_from: "2026-10-10", policy: POLICY_BODY_JSON },
  versions: [
    { version_id: POLICY_VERSION, version_no: 2, effective_from: "2026-10-10", created_at: "2026-10-10T05:00:00+00:00" },
    { version_id: "9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c", version_no: 1, effective_from: "2026-10-01", created_at: "2026-10-01T05:00:00+00:00" },
  ],
};

const LINE_CALC = { sku: "PV80-GREY", name: "Paver block 80 mm grey (synthetic)", hsn: "68101990", mode: "area", unit_price_paise: 6500, gst_bps: 1800, pieces: 4725, pieces_without_wastage: 4500, pallets: 10, delivered_area_x100: 105000, billed_quantity: 105000, billed_per: "sq_ft", load: 4725, material: 6825000, tax: 1228500, gross: 8053500 };
export const CALC_JSON = {
  status: "draft", engine_version: "1.0.0", canonical_hash: "d1590de3e45a51fd320ba7e33df32423f4557740cedb9c0feaf7a5a75f8c8c43",
  flags: { needs_owner_approval: false, reasons: [] }, lines: [LINE_CALC], trips: 2,
  totals: { material: 6825000, transport: 700000, handling: 0, laying: 0, subtotal: 7525000, item_tax: 1228500, transport_tax: 126000, handling_tax: 0, laying_tax: 0, tax: 1354500, total: 8879500 },
  payment_terms: { advance_amount: 4439750, balance: 4439750, credit_days: 0, due_date: null, balance_on: "delivery" }, valid_until: "2026-10-21", range: { total_low: 8496000, total_high: 8879500 },
  trace: [
    { rule_id: "quantity.area", inputs: { area_x100: 100000, pieces_without_wastage: 4500, wastage_bps: 500, pieces: 4725, pallets: 10 }, text: "quantity.area: {}" },
    { rule_id: "material.per_area", inputs: { billed_area_x100: 105000, unit_price_paise: 6500, material: 6825000 }, text: "material.per_area: {}" },
    { rule_id: "tax.item", inputs: { gst_bps: 1800, tax: 1228500 }, text: "tax.item: {}" },
    { rule_id: "trips", inputs: { load: 4725, capacity: 2500, trips: 2 }, text: "trips: {}" },
    { rule_id: "transport.per_trip", inputs: { trips: 2, rate_per_trip_paise: 350000, transport: 700000 }, text: "transport.per_trip: {}" },
    { rule_id: "payment.terms", inputs: { advance: 4439750, balance: 4439750, credit_days: 0 }, text: "payment.terms: {}" },
    { rule_id: "quote.validity", inputs: { valid_until: "2026-10-21" }, text: "quote.validity: {}" },
  ],
};
export const PREVIEW_JSON = { as_of: "2026-10-14", valid_until: "2026-10-21", result: CALC_JSON, database_agrees: true };
export const REJECTED_CALC_JSON = { status: "rejected", engine_version: "1.0.0", canonical_hash: null, codes: ["LAYING_RATE_MISSING"], flags: { needs_owner_approval: false, reasons: [] } };

export const QUOTE_LINE_JSON = {
  line_no: 1, catalogue_item_id: ITEM, name: ITEM_JSON.name, mode: "area", sold_per: "sq_ft", unit_price_paise: 6500, gst_bps: 1800, hsn: "68101990", area_x100: 100000, area_unit: "sq_ft", pieces: 4725, pallets: 10,
  delivered_area_x100: 105000, billed_quantity: 105000, material_paise: 6825000, tax_paise: 1228500,
};
export const QUOTE_JSON = {
  id: QUOTE, quote_no: 12, requirement_id: REQUIREMENT, enquiry_id: ENQUIRY, lead_id: LEAD, site_id: SITE, status: "draft", policy_version_id: POLICY_VERSION, engine_version: "1.0.0",
  canonical_hash: CALC_JSON.canonical_hash, as_of: "2026-10-14", valid_until: "2026-10-21", due_date: null, trips: 2, material_paise: 6825000, transport_paise: 700000, handling_paise: 0, laying_paise: 0,
  tax_paise: 1354500, total_paise: 8879500, advance_paise: 4439750, balance_paise: 4439750, flags: [], needs_owner_approval: false, created_at: "2026-10-14T05:00:00+00:00", approved_at: null, rejected_at: null,
  reject_code: null, lines: [QUOTE_LINE_JSON],
};
export const QUOTE_DETAIL_JSON = { ...QUOTE_JSON, trace: CALC_JSON.trace };
export const QUOTE_APPROVED_JSON = { ...QUOTE_DETAIL_JSON, status: "approved", approved_at: "2026-10-14T06:00:00+00:00" };
export const QUOTE_FLAGGED_JSON = { ...QUOTE_DETAIL_JSON, flags: ["CREDIT_LIMIT_EXCEEDED"], needs_owner_approval: true };
export const QUOTE_LIST_JSON = { items: [QUOTE_JSON, { ...QUOTE_JSON, id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2", quote_no: 11, status: "approved", total_paise: 2450000 }] };
export const DRAFT_JSON = { quote: QUOTE_JSON, replayed: false };
export const TEXT_JSON = { language: "en", language_review: "reviewed", text: "Quotation 12\nPaver block 80 mm grey (synthetic): 1,000 sq ft = 4,725 pieces (10 pallets)\nTotal ₹88,795.00\nAdvance ₹44,397.50 before dispatch\nValid until 21 Oct 2026" };
export const ORDER_CREATED_JSON = { order_id: ORDER, order_no: 7, state: "quote_approved", replayed: false, credit: null };
export const ORDER_CREDIT_JSON = { ...ORDER_CREATED_JSON, credit: { credit_limit_paise: 5000000, outstanding_paise: 3000000, would_be_paise: 11879500, exceeded: true } };
