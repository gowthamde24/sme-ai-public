/** Synthetic quote bodies as the API sends them (shared by the quote tests). Nothing here is a real price, customer or tax rate. */
export const TENANT = "22222222-2222-2222-2222-222222222222";
export const ENQ = "44444444-4444-4444-4444-444444444444";
export const QUOTE = "88888888-8888-4888-8888-888888888888";
export const REQ = "66666666-6666-4666-8666-666666666666";
export const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

export const LINE_JSON = {
  line_no: 1, requirement_line_no: 1, product_id: P1, sku: "SYN-K", name: "Synthetic kanjivaram", sale_unit: "piece", qty: 20, unit_price_applied_paise: 380000,
  price_break_min_qty: 10, line_subtotal_paise: 7600000, net_paise: 7600000, tax_paise: 380000, gross_paise: 7980000, tax_bps: 500,
};
export const QUOTE_JSON = {
  id: QUOTE, quote_no: 3, requirement_id: REQ, enquiry_id: ENQ, lead_id: "33333333-3333-3333-3333-333333333333", status: "draft", outcome: "draft",
  price_list_version_id: "77777777-7777-4777-8777-777777777777", policy_version_id: "99999999-9999-4999-8999-999999999999", engine_version: "1.1.0",
  canonical_hash: "0123456789abcdef".repeat(4), customer_kind: "new", delivery_state: "MH", gst_supply: "inter_state", as_of: "2026-10-06", valid_until: "2026-10-21",
  due_date: "2026-11-05", merchandise_net_paise: 7600000, item_tax_paise: 380000, shipping_net_paise: 5000, shipping_tax_paise: 900, total_paise: 7985900,
  advance_paise: 3992950, balance_paise: 3992950, engine_flags: [], review_flags: [], needs_owner_approval: false, created_by: null,
  created_at: "2026-10-06T05:00:00+00:00", approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, reject_code: null,
  withdrawn_by: null, withdrawn_at: null, withdraw_code: null, lines: [LINE_JSON], unquoted_lines: [],
};
export const SUMMARY_JSON = {
  id: QUOTE, quote_no: 3, enquiry_id: ENQ, status: "draft", outcome: "draft", customer_kind: "new", valid_until: "2026-10-21", total_paise: 7985900,
  needs_owner_approval: false, created_at: "2026-10-06T05:00:00+00:00", customer: "Synthetic Buyer", city: "Hyderabad",
};
export const ITEM_JSON = { product_id: P1, sku: "SYN-K", name: "Synthetic kanjivaram", sale_unit: "piece", unit_price_paise: 400000, minimum_order_quantity: 4, tax_bps: 500 };
export const ITEM2_JSON = { product_id: P2, sku: "SYN-B", name: "Synthetic banarasi", sale_unit: "piece", unit_price_paise: 310000, minimum_order_quantity: 4, tax_bps: 1200 };
export const SETUP_JSON = {
  requirement_id: REQ, requirement_status: "confirmed", today: "2026-10-06", price_list_version_id: "77777777-7777-4777-8777-777777777777",
  policy_version_id: "99999999-9999-4999-8999-999999999999", seller_state: "TG", required_inputs: ["delivery_state"], mapper_version: "1.0.0", missing: [],
  lines: [
    {
      line_no: 1, summary: ["Saree type: Kanjivaram", "Quantity: 20 pieces"], quantity: 20, basis: "piece", quotable: true, pick: null,
      suggestion: { status: "matched", reason: null, candidates: [ITEM_JSON], truncated: false },
    },
    { line_no: 2, summary: ["Saree type: Banarasi (not confirmed)"], quantity: null, basis: null, quotable: false, pick: null, suggestion: null },
  ],
  price_list: [ITEM2_JSON, ITEM_JSON],
  delivery_states: { MH: "Maharashtra", TG: "Telangana", KA: "Karnataka" },
};
export const TEXT_JSON = { text: "Approved quote\nGrand total: ₹79,859.00", line_count: 2, canonical_hash: "f".repeat(64), renderer_version: "1.2.0", sent_by_system: false };

// ----------------------------------------------------------------------------- a quote whose prices a person typed (manual-price quote, slice 4a). "Type A" and "Type B" are synthetic item types.
export const MANUAL_QUOTE = "88888888-8888-4888-8888-888888888889";
export const MANUAL_LINE_JSON = {
  line_no: 1, requirement_line_no: 1, product_id: null, sku: "LINE-1", name: "Type A", sale_unit: "piece", qty: 3, unit_price_applied_paise: 250000,
  price_break_min_qty: null, line_subtotal_paise: 750000, net_paise: 750000, tax_paise: 37500, gross_paise: 787500, tax_bps: 500, price_source: "typed_by_person", item_type_code: "A",
};
export const MANUAL_LINE2_JSON = {
  ...MANUAL_LINE_JSON, line_no: 2, requirement_line_no: 2, sku: "LINE-2", name: "Type B", qty: 1, unit_price_applied_paise: 99999, line_subtotal_paise: 99999, net_paise: 99999,
  tax_paise: 5000, gross_paise: 104999, item_type_code: "B",
};
export const MANUAL_QUOTE_JSON = {
  ...QUOTE_JSON, id: MANUAL_QUOTE, quote_no: 4, pricing_kind: "manual", price_list_version_id: null, delivery_state: null, gst_supply: null,
  merchandise_net_paise: 849999, item_tax_paise: 42500, shipping_net_paise: 0, shipping_tax_paise: 0, total_paise: 892499, advance_paise: 446250, balance_paise: 446249,
  lines: [MANUAL_LINE_JSON, MANUAL_LINE2_JSON],
};
export const MANUAL_SUMMARY_JSON = { ...SUMMARY_JSON, id: MANUAL_QUOTE, quote_no: 4, pricing_kind: "manual", total_paise: 892499 };
// the item types as GET /item-types sends them (synthetic): B has a usual range, C is no longer sold
export const TYPE_A_JSON = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", code: "A", name: "Type A", position: 1, active: true, min_price_paise: null, max_price_paise: null };
export const TYPE_B_JSON = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", code: "B", name: "Type B", position: 2, active: true, min_price_paise: 50000, max_price_paise: 400000 };
export const TYPE_C_JSON = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", code: "C", name: "Type C (not sold)", position: 0, active: false, min_price_paise: null, max_price_paise: null };
