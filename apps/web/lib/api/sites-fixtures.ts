export const SITE = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
export const COMPANY = "11111111-1111-4111-8111-111111111111";
export const CONTACT = "22222222-2222-4222-8222-2222222222aa";
export const SITE_JSON = {
  id: SITE, company_id: COMPANY, name: "Kukatpally villa (synthetic)", address_line: "Plot 14, Road 3", city: "Hyderabad", pin: "500072", map_lat: 17.4948, map_lng: 78.3996, distance_km: 18, lane_width_ft: 12,
  night_delivery: false, unloading_help: true, access_notes: "Gate on the left, narrow bend after the temple", site_contact_id: CONTACT, active: true, created_at: "2026-10-10T05:00:00+00:00", updated_at: "2026-10-12T05:00:00+00:00",
};
export const SITE_PUT_JSON = { site: SITE_JSON, created: false };
export const SITE_LIST_JSON = { items: [SITE_JSON, { ...SITE_JSON, id: "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b", name: "Godown (synthetic)", map_lat: null, map_lng: null, site_contact_id: null, active: false }], next_cursor: null };
