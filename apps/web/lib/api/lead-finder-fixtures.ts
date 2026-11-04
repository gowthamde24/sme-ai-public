/**
 * Made-up Lead Finder answers in the API's own shape (snake_case), for the tests and the screen snapshots only. The businesses are invented (the contract's demo set): no real shop, phone or place.
 */
export const T = "55555555-5555-4555-8555-555555555555";
export const S1 = "a1a1a1a1-0000-4000-8000-000000000001";
export const P1 = "b1b1b1b1-0000-4000-8000-000000000001";
export const P2 = "b1b1b1b1-0000-4000-8000-000000000002";
export const P3 = "b1b1b1b1-0000-4000-8000-000000000003";
export const L1 = "c1c1c1c1-0000-4000-8000-000000000001";
const AT = "2026-10-06T04:00:00Z";

export const AVAILABLE = { available: true, source: "fixture", reason: "ok" };
export const AVAILABLE_PLACES = { available: true, source: "places", reason: "ok" };
export const SCHOOL = { available: false, source: null, reason: "not_for_this_business" };

export const SEARCH_PLANNED = {
  id: S1, state: "planned", query: "saree shops", area: "Jayanagar Bengaluru", category_hint: "retailer", max_results: 20, provider: "fixture", sku: "fixture",
  est_cost_paise: 0, cost_paise: 0, cost_is_estimate: false, source_label: "Example search (made-up businesses) 'saree shops Jayanagar Bengaluru', 6 Oct", found: 0, counts: null, searches_left_today: 5, attribution: null,
  created_at: AT, approved_at: null, finished_at: null,
};
export const SEARCH_DONE = {
  ...SEARCH_PLANNED, state: "done", found: 20, searches_left_today: 4, approved_at: AT, finished_at: AT,
  counts: { found: 20, new: 18, duplicates: 2, call_ready: 0, needs_owner: 11, skipped: 7, researching: 0, duplicate_customer: 1, duplicate_company: 0, duplicate_prospect: 1, duplicate_suppressed: 0 },
};
export const SEARCH_PLACES = { ...SEARCH_PLANNED, provider: "places", sku: "places_text_search_enterprise", est_cost_paise: 2950, cost_is_estimate: true, attribution: "Google Maps", source_label: "Google Maps search 'saree shops Jayanagar Bengaluru', 6 Oct" };

export const PROSPECT = {
  id: P1, search_id: S1, name: "Sri Lakshmi Sarees", category: "Saree shop", area: "Jayanagar", phone: "+00 000 5123 4567", website: null, rating: 4.5, review_count: 312, lat: 12.93, lng: 77.58,
  source: "fixture", source_label: "Example search (made-up businesses) 'saree shops Jayanagar Bengaluru', 6 Oct", attribution: null,
  status: "needs_owner", decision_reason: "first_calls", fit_score: 82, fit_reason: "Saree shop; we have Kanchi Pattu Bridal, Dharmavaram Silk Classic in stock; 312 reviews",
  stock_match: { matched: ["Kanchi Pattu Bridal"], low: ["Soft Silk Daily"], enough: true }, owner_approved: false, suppressed: false, ask_after: null, last_contacted_at: null, lead_id: null,
  qualification: null, created_at: AT, updated_at: AT,
};
export const PROSPECT_LOW = { ...PROSPECT, id: P2, name: "Sri Sai Constructions", category: "Hardware dealer", area: "Basavanagudi", decision_reason: "low_stock", fit_score: 64, fit_reason: "Dealer; only some items in stock", review_count: 40 };
export const PROSPECT_READY = { ...PROSPECT, id: P3, name: "Padmavathi Silks", area: "JP Nagar", status: "call_ready", decision_reason: "owner_approved", fit_score: 78, owner_approved: true };
export const PROSPECT_QUALIFIED = { ...PROSPECT_READY, status: "qualified", lead_id: L1 };

export const PRACTICE = {
  simulated: true, call_id: "d1d1d1d1-0000-4000-8000-000000000001", prospect: PROSPECT_QUALIFIED, persona: "interested", language: "te", outcome: "qualified", end_reason: "goodbye",
  summary: "Sells silk sarees, about 20 a month.\nWants new designs before the wedding season.\nInterested: the owner should call with a quote.", whatsapp_ok: false, pitched: ["Kanchi Pattu Bridal"],
  quote_suggestion: [{ item: "Kanchi Pattu Bridal", unit: "piece", price_paise: 1850000, moq: 2, quantity_said: "about 20 a month" }, { item: "Dharmavaram Silk Classic", unit: "piece", price_paise: null, moq: null, quantity_said: "about 20 a month" }],
  transcript: [{ who: "assistant", text: "Namaste, I am the AI assistant of Acme Silks.", t: 0 }, { who: "business", text: "Yes, tell me.", t: 4.5 }],
  evals: { disclosure_first_10s: true, never_pitches_out_of_stock: true, never_invents_prices: true },
};

export const SETTINGS = { fit_bar: 70, daily_call_cap: 20, call_from_hour: 10, call_to_hour: 19, searches_per_day: 5, results_per_search: 20, updated_at: null };
