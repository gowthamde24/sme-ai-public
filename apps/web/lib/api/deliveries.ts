import type { ChallanOut, NotifyOut, ProofOut, TripDetailOut, TripEventOut, TripLineOut, TripOut } from "@contracts";

import { ApiContractError, apiRequest, apiUploadRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, int, iso, list, nstr, oneOf, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * Deliveries (job CO, on the API of job CN, ADR 0085; module `deliveries`): an order is delivered in one or more trips, each with a date, a vehicle, a driver, a site and the quantities it carries; a trip goes
 * planned, loaded, on the way, delivered (with a photo and the name of who received the goods) or problem (with a reason from a closed list). The delivery note (challan) has no amounts and no tax. Server side
 * only, with the signed-in user's own token. Owner, Admin and Sales do all of it; a Viewer sees nothing. A response that does not match the contract is an error and nothing is shown.
 */
export const TRIP_STATUSES = ["planned", "loaded", "on_the_way", "delivered", "problem", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const SETTABLE_STATUSES = ["planned", "loaded", "on_the_way", "problem", "cancelled"] as const;
export const PROBLEM_CODES = ["truck_breakdown", "customer_not_ready", "site_closed", "wrong_material", "road_blocked", "other"] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];
export const NOTIFY_KINDS = ["left", "soon", "delivered", "delay"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));
const optUuid = (v: unknown, what: string) => (v === null || v === undefined ? null : uuid(v, what));
const picture = (v: unknown, what: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > 2048) return bad(what);
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : bad(what);
  } catch {
    return bad(what);
  }
};

function parseLine(json: unknown): TripLineOut {
  const r = rec(json, "trip line");
  return { quote_line_id: uuid(r.quote_line_id, "quote_line_id"), line_no: int(r.line_no, "line_no", 1, 200), name: nstr(r.name, "name", 200), quantity: int(r.quantity, "quantity", 0, 1_000_000_000_000), unit: str(r.unit, "unit", 40) };
}

export function parseProof(json: unknown): ProofOut | null {
  if (json === null || json === undefined) return null;
  const r = rec(json, "proof");
  return {
    received_by: str(r.received_by, "received_by", 120),
    recorded_at: iso(r.recorded_at, "recorded_at"),
    width: int(r.width, "width", 0, 20000),
    height: int(r.height, "height", 0, 20000),
    bytes: int(r.bytes, "bytes", 0, 50_000_000),
    photo_url: picture(r.photo_url, "photo_url"),
    expires_in_seconds: int(r.expires_in_seconds, "expires", 0, 86_400 * 7),
  };
}

function tripFields(r: Record<string, unknown>): TripOut {
  return {
    id: uuid(r.id, "id"),
    order_id: uuid(r.order_id, "order_id"),
    order_no: int(r.order_no, "order_no", 1, 10_000_000),
    trip_no: int(r.trip_no, "trip_no", 1, 100_000),
    challan_no: int(r.challan_no, "challan_no", 1, 100_000_000),
    site_id: optUuid(r.site_id, "site_id"),
    site_contact_id: optUuid(r.site_contact_id, "site_contact_id"),
    planned_date: day(r.planned_date, "planned_date"),
    vehicle_no: optStr(r.vehicle_no, "vehicle_no", 40),
    driver_name: optStr(r.driver_name, "driver_name", 120),
    driver_phone: optStr(r.driver_phone, "driver_phone", 30),
    status: oneOf(r.status, TRIP_STATUSES, "status"),
    problem_code: r.problem_code === null || r.problem_code === undefined ? null : oneOf(r.problem_code, PROBLEM_CODES, "problem_code"),
    created_at: iso(r.created_at, "created_at"),
    updated_at: iso(r.updated_at, "updated_at"),
    delivered_at: optIso(r.delivered_at, "delivered_at"),
    lines: list(r.lines, "lines", 100).map(parseLine),
    proof: parseProof(r.proof),
  };
}

export function parseTrip(json: unknown): TripOut {
  return tripFields(rec(json, "trip"));
}

export function parseTripList(json: unknown): { items: TripOut[] } {
  return { items: list(rec(json, "trip list").items, "items", 300).map(parseTrip) };
}

export function parseTripDetail(json: unknown): TripDetailOut {
  const r = rec(json, "trip");
  return {
    ...tripFields(r),
    events: list(r.events, "events", 200).map((e): TripEventOut => {
      const x = rec(e, "trip event");
      const status = (v: unknown, w: string) => oneOf(v, TRIP_STATUSES, w);
      return {
        seq: int(x.seq, "seq", 1, 100_000),
        from_status: x.from_status === null || x.from_status === undefined ? null : status(x.from_status, "from_status"),
        to_status: status(x.to_status, "to_status"),
        problem_code: x.problem_code === null || x.problem_code === undefined ? null : oneOf(x.problem_code, PROBLEM_CODES, "problem_code"),
        recorded_at: iso(x.recorded_at, "recorded_at"),
      };
    }),
  };
}

export function parseChallan(json: unknown): ChallanOut {
  const r = rec(json, "challan");
  const site = r.site === null || r.site === undefined ? null : rec(r.site, "site");
  const contact = r.site_contact === null || r.site_contact === undefined ? null : rec(r.site_contact, "site_contact");
  return {
    challan_no: int(r.challan_no, "challan_no", 1, 100_000_000),
    trip_no: int(r.trip_no, "trip_no", 1, 100_000),
    order_no: int(r.order_no, "order_no", 1, 10_000_000),
    date: day(r.date, "date"),
    business: str(r.business, "business", 200),
    customer: optStr(r.customer, "customer", 200),
    site: site ? { name: nstr(site.name, "site name", 200), address_line: optStr(site.address_line, "address_line", 400), city: optStr(site.city, "city", 120), pin: optStr(site.pin, "pin", 12), access_notes: optStr(site.access_notes, "access_notes", 1000) } : null,
    site_contact: contact ? { name: nstr(contact.name, "contact name", 200), phone: optStr(contact.phone, "contact phone", 30) } : null,
    vehicle_no: optStr(r.vehicle_no, "vehicle_no", 40),
    driver_name: optStr(r.driver_name, "driver_name", 120),
    driver_phone: optStr(r.driver_phone, "driver_phone", 30),
    status: oneOf(r.status, TRIP_STATUSES, "status"),
    lines: list(r.lines, "lines", 100).map((l) => {
      const x = rec(l, "challan line");
      return { line_no: int(x.line_no, "line_no", 1, 200), description: str(x.description, "description", 300), quantity: int(x.quantity, "quantity", 0, 1_000_000_000_000), unit: str(x.unit, "unit", 40), hsn: optStr(x.hsn, "hsn", 20) };
    }),
    received_by: optStr(r.received_by, "received_by", 120),
    received_at: optStr(r.received_at, "received_at", 40),
  };
}

export function parseNotify(json: unknown): NotifyOut {
  const r = rec(json, "notify");
  return { message_id: uuid(r.message_id, "message_id"), status: oneOf(r.status, ["queued", "needs_approval", "blocked", "sent", "failed"] as const, "status"), reason: word(r.reason, "reason", 80), text: str(r.text, "text", 1000), replayed: r.replayed === true };
}

const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type TripInput = { tripId?: string; plannedDate: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; siteId: string | null; siteContactId: string | null; lines: readonly { line_no: number; quantity: number }[] };

const tripBody = (t: TripInput) => {
  if (!DAY.test(t.plannedDate)) throw new ApiContractError("date");
  return { planned_date: t.plannedDate, vehicle_no: t.vehicleNo, driver_name: t.driverName, driver_phone: t.driverPhone, site_id: t.siteId, site_contact_id: t.siteContactId, lines: t.lines };
};

/** `POST /orders/{id}/trips`: plan a trip; the same `tripId` is a retry. Needs an accepted order. */
export async function planTrip(accessToken: string, tenantId: string, orderId: string, t: TripInput & { tripId: string }) {
  return parseTrip(await apiRequest(tenantPath(tenantId, `orders/${idOf(orderId)}/trips`), accessToken, { method: "POST", body: JSON.stringify({ trip_id: idOf(t.tripId), ...tripBody(t) }) }));
}

export async function listOrderTrips(accessToken: string, tenantId: string, orderId: string) {
  return parseTripList(await apiRequest(tenantPath(tenantId, `orders/${idOf(orderId)}/trips`), accessToken));
}

/** `GET /trips?date=&status=`: the trips of a day or of a status (the board). */
export async function listTrips(accessToken: string, tenantId: string, opts: { date?: string; status?: TripStatus; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 100) });
  if (opts.date) {
    if (!DAY.test(opts.date)) throw new ApiContractError("date");
    q.set("date", opts.date);
  }
  if (opts.status) q.set("status", opts.status);
  return parseTripList(await apiRequest(tenantPath(tenantId, `trips?${q.toString()}`), accessToken));
}

export async function getTrip(accessToken: string, tenantId: string, id: string) {
  return parseTripDetail(await apiRequest(tenantPath(tenantId, `trips/${idOf(id)}`), accessToken));
}

/** `PATCH /trips/{id}`: change the plan (date, vehicle, driver, site, quantities) while it can still change. */
export async function updateTrip(accessToken: string, tenantId: string, id: string, t: TripInput) {
  return parseTrip(await apiRequest(tenantPath(tenantId, `trips/${idOf(id)}`), accessToken, { method: "PATCH", body: JSON.stringify(tripBody(t)) }));
}

/** `POST /trips/{id}/status`: loaded, on the way, problem (with a reason), back to planned, or cancelled. "Delivered" has its own call with the proof. */
export async function setTripStatus(accessToken: string, tenantId: string, id: string, status: (typeof SETTABLE_STATUSES)[number], problem?: ProblemCode) {
  return parseTrip(await apiRequest(tenantPath(tenantId, `trips/${idOf(id)}/status`), accessToken, { method: "POST", body: JSON.stringify({ status, ...(problem ? { problem_code: problem } : {}) }) }));
}

/** `POST /trips/{id}/delivered?received_by=&photo_id=`: the proof. The BODY is the photo with its own type; the same `photoId` is a retry. */
export async function markDelivered(accessToken: string, tenantId: string, id: string, receivedBy: string, photoId: string, photo: ArrayBuffer | Blob, contentType: string) {
  if (!(PROOF_TYPES as readonly string[]).includes(contentType)) throw new ApiContractError("type");
  const name = receivedBy.trim();
  if (name === "" || name.length > 80) throw new ApiContractError("name");
  return parseTrip(await apiUploadRequest(tenantPath(tenantId, `trips/${idOf(id)}/delivered?received_by=${encodeURIComponent(name)}&photo_id=${idOf(photoId)}`), accessToken, photo, contentType));
}

export async function getChallan(accessToken: string, tenantId: string, id: string) {
  return parseChallan(await apiRequest(tenantPath(tenantId, `trips/${idOf(id)}/challan`), accessToken));
}

/** `POST /trips/{id}/notify`: a fixed message to the site contact through the outbox ("truck left, arriving about 3 pm"); the same `messageId` is a retry. A delay is held for a person. */
export async function notifySite(accessToken: string, tenantId: string, id: string, input: { messageId: string; kind: NotifyKind; eta?: string | null; language?: "en" | "te" | "hi" | "kn" | "ta" }) {
  return parseNotify(await apiRequest(tenantPath(tenantId, `trips/${idOf(id)}/notify`), accessToken, { method: "POST", body: JSON.stringify({ message_id: idOf(input.messageId), kind: input.kind, ...(input.eta ? { eta: input.eta } : {}), language: input.language ?? "en" }) }));
}
