/** Synthetic delivery answers as the API sends them (job CO). Nothing here is a real vehicle, driver, site or person. */
export const TRIP = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
export const TRIP2 = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
export const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const SITE = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
export const LINE_ID = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";

const trip = (over: object = {}) => ({
  id: TRIP, order_id: ORDER, order_no: 7, trip_no: 1, challan_no: 41, site_id: SITE, site_contact_id: null, planned_date: "2026-10-20", vehicle_no: "TS 09 UA 1234", driver_name: "Suresh (synthetic)", driver_phone: "+00 90000 20001",
  status: "planned", problem_code: null, created_at: "2026-10-14T05:00:00+00:00", updated_at: "2026-10-14T05:00:00+00:00", delivered_at: null,
  lines: [{ quote_line_id: LINE_ID, line_no: 1, name: "Paver block 80 mm grey (synthetic)", quantity: 2500, unit: "piece" }], proof: null, ...over,
});
export const TRIP_JSON = trip();
export const TRIP_ON_THE_WAY_JSON = trip({ id: TRIP2, trip_no: 2, status: "on_the_way", lines: [{ quote_line_id: LINE_ID, line_no: 1, name: "Paver block 80 mm grey (synthetic)", quantity: 2225, unit: "piece" }] });
export const TRIP_DELIVERED_JSON = trip({ status: "delivered", delivered_at: "2026-10-20T09:00:00+00:00", proof: { received_by: "Ravi (synthetic)", recorded_at: "2026-10-20T09:00:00+00:00", width: 1024, height: 768, bytes: 90_000, photo_url: "https://files.example.test/proof.jpg?sig=x", expires_in_seconds: 600 } });
export const TRIP_PROBLEM_JSON = trip({ status: "problem", problem_code: "site_closed" });
export const TRIP_LIST_JSON = { items: [TRIP_JSON, TRIP_ON_THE_WAY_JSON] };
export const TRIP_DETAIL_JSON = {
  ...TRIP_DELIVERED_JSON,
  events: [
    { seq: 1, from_status: null, to_status: "planned", problem_code: null, recorded_at: "2026-10-14T05:00:00+00:00" },
    { seq: 2, from_status: "planned", to_status: "loaded", problem_code: null, recorded_at: "2026-10-20T04:00:00+00:00" },
    { seq: 3, from_status: "loaded", to_status: "on_the_way", problem_code: null, recorded_at: "2026-10-20T05:00:00+00:00" },
    { seq: 4, from_status: "on_the_way", to_status: "delivered", problem_code: null, recorded_at: "2026-10-20T09:00:00+00:00" },
  ],
};
export const CHALLAN_JSON = {
  challan_no: 41, trip_no: 1, order_no: 7, date: "2026-10-20", business: "Pavers Corner (synthetic)", customer: "Sri Rama Builders (synthetic)",
  site: { name: "Kukatpally villa (synthetic)", address_line: "Plot 14, Road 3", city: "Hyderabad", pin: "500072", access_notes: "Gate on the left" }, site_contact: { name: "Ravi (synthetic)", phone: "+00 90000 20002" },
  vehicle_no: "TS 09 UA 1234", driver_name: "Suresh (synthetic)", driver_phone: "+00 90000 20001", status: "planned",
  lines: [{ line_no: 1, description: "Paver block 80 mm grey (synthetic)", quantity: 2500, unit: "piece", hsn: "68101990" }], received_by: null, received_at: null,
};
export const NOTIFY_JSON = { message_id: "77777777-7777-4777-8777-777777777777", status: "queued", reason: "ok", text: "Truck TS 09 UA 1234 has left with your material and should reach the site around 3 pm.", replayed: false };
