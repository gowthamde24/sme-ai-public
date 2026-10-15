import type { CalcOut, MaterialItemOut, MaterialItemSummaryOut, MaterialPhotoOut, MaterialQuoteDetailOut, MaterialQuoteOut, OrderCreatedOut, PolicyBody, PolicyOut, QuoteLineOut, QuotePreviewOut, QuoteTextOut } from "@contracts";

import { ApiContractError, apiRequest, apiUploadRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, nstr, oneOf, optInt, optIso, optStr, rec, str, uuid, word, type Rec } from "./shape";

/**
 * Building materials (job CO, on the API of job CN, ADR 0085): the products (catalogue items of kind `material`), the owner's quote rules (the policy), and the material quotes from preview to order. Server side
 * only, with the signed-in user's own token. Names are the contract's (snake_case). Money is integer paise, rates integer basis points, an area integer hundredths of its unit, pieces per area integer thousandths.
 * A response that does not match the contract is an error and nothing is shown.
 *
 * Who may do what (the API decides; the screens only hide what it would refuse): every member reads the products; Owner and Admin keep them and the exact price is theirs; Owner, Admin and Sales read the rules and
 * the quotes and make a draft; Owner and Admin approve, and make an order, with the second factor; the Owner alone saves the rules (second factor). A flagged quote is approved by the Owner alone.
 */
export const SELL_UNITS = ["piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"] as const;
export type SellUnit = (typeof SELL_UNITS)[number];
export const AREA_UNITS = ["sq_ft", "sq_m"] as const;
export const STOCK_STATUSES = ["in_stock", "few_left", "made_to_order"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
export const QUOTE_STATUSES = ["draft", "approved", "rejected", "superseded"] as const;
export const REJECT_CODES = ["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"] as const;
export type RejectCode = (typeof REJECT_CODES)[number];
export const LANGUAGES = ["en", "te", "hi", "kn", "ta"] as const;
export const MAX_PAISE = 100_000_000_000;
export const MAX_PHOTOS = 8;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const paise = (v: unknown, what: string) => int(v, what, 0, MAX_PAISE);
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

export function parsePhoto(json: unknown): MaterialPhotoOut {
  const r = rec(json, "photo");
  return {
    id: uuid(r.id, "photo id"),
    position: int(r.position, "position", 1, 20),
    url: picture(r.url, "url"),
    thumb_url: picture(r.thumb_url, "thumb_url"),
    width: int(r.width, "width", 0, 20000),
    height: int(r.height, "height", 0, 20000),
    bytes: int(r.bytes, "bytes", 0, 50_000_000),
    expires_in_seconds: int(r.expires_in_seconds, "expires", 0, 86_400 * 7),
  };
}

const unit = (v: unknown, what: string) => oneOf(v, SELL_UNITS, what);
const areaUnit = (v: unknown) => (v === null || v === undefined ? null : oneOf(v, AREA_UNITS, "area_unit"));

export function parseInputs(json: unknown): MaterialItemOut["inputs"] {
  const r = rec(json, "inputs");
  return {
    price_paise: optInt(r.price_paise, "price", 0, MAX_PAISE),
    gst_bps: optInt(r.gst_bps, "gst_bps", 0, 10_000),
    hsn: optStr(r.hsn, "hsn", 20),
    pieces_per_area_x1000: optInt(r.pieces_per_area_x1000, "pieces_per_area", 0, 100_000_000),
    pieces_per_pallet: optInt(r.pieces_per_pallet, "pieces_per_pallet", 0, 10_000_000),
    min_order_qty: optInt(r.min_order_qty, "min_order_qty", 0, 100_000_000),
    lead_days: optInt(r.lead_days, "lead_days", 0, 3650),
    missing_for_area: list(r.missing_for_area, "missing_for_area", 20).map((x) => word(x, "missing")),
    missing_for_quantity: list(r.missing_for_quantity, "missing_for_quantity", 20).map((x) => word(x, "missing")),
  };
}

function itemBase(r: Rec) {
  return {
    id: uuid(r.id, "id"),
    name: nstr(r.name, "name", 200),
    sell_unit: unit(r.sell_unit, "sell_unit"),
    area_unit: areaUnit(r.area_unit),
    stock_status: oneOf(r.stock_status, STOCK_STATUSES, "stock_status"),
    active: bool(r.active, "active"),
    price_paise: optInt(r.price_paise, "price_paise", 0, MAX_PAISE),
    price_text: optStr(r.price_text, "price_text", 200),
    photo_count: int(r.photo_count, "photo_count", 0, MAX_PHOTOS + 4),
  };
}

export function parseItemSummary(json: unknown): MaterialItemSummaryOut {
  const r = rec(json, "item");
  return { ...itemBase(r), cover: r.cover === null || r.cover === undefined ? null : parsePhoto(r.cover) };
}

export function parseItem(json: unknown): MaterialItemOut {
  const r = rec(json, "item");
  return {
    ...itemBase(r),
    photos: list(r.photos, "photos", MAX_PHOTOS + 4).map(parsePhoto),
    inputs: parseInputs(r.inputs),
    created_at: iso(r.created_at, "created_at"),
    updated_at: iso(r.updated_at, "updated_at"),
  };
}

export function parseItemList(json: unknown): { items: MaterialItemSummaryOut[]; next_cursor: string | null } {
  const r = rec(json, "item list");
  return { items: list(r.items, "items", 100).map(parseItemSummary), next_cursor: optStr(r.next_cursor, "next_cursor", 400) };
}

export function parseItemSaved(json: unknown): { item: MaterialItemOut; created: boolean } {
  const r = rec(json, "saved item");
  return { item: parseItem(r.item), created: bool(r.created, "created") };
}

export function parsePhotoResult(json: unknown): { photo: MaterialPhotoOut; replayed: boolean; item: MaterialItemOut } {
  const r = rec(json, "photo result");
  return { photo: parsePhoto(r.photo), replayed: r.replayed === true, item: parseItem(r.item) };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ the owner's rules
export const TRANSPORT_KINDS = ["none", "per_trip", "per_km_slab"] as const;

function parseSlabs(v: unknown) {
  if (v === null || v === undefined) return null;
  return list(v, "slabs", 20).map((s) => {
    const r = rec(s, "slab");
    return { up_to_km: int(r.up_to_km, "up_to_km", 0, 5000), charge_paise: paise(r.charge_paise, "charge_paise") };
  });
}

export function parsePolicyBody(json: unknown): PolicyBody {
  const r = rec(json, "policy");
  const t = r.transport === null || r.transport === undefined ? undefined : rec(r.transport, "transport");
  const h = r.handling === null || r.handling === undefined ? null : rec(r.handling, "handling");
  const l = r.laying === null || r.laying === undefined ? null : rec(r.laying, "laying");
  return {
    ...(r.default_wastage_bps === undefined ? {} : { default_wastage_bps: int(r.default_wastage_bps, "wastage", 0, 10_000) }),
    ...(r.round_to_pallet === undefined ? {} : { round_to_pallet: bool(r.round_to_pallet, "round_to_pallet") }),
    ...(r.bill_wastage === undefined ? {} : { bill_wastage: bool(r.bill_wastage, "bill_wastage") }),
    ...(t
      ? {
          transport: {
            kind: oneOf(t.kind ?? "none", TRANSPORT_KINDS, "transport kind"),
            capacity_basis: t.capacity_basis === null || t.capacity_basis === undefined ? null : oneOf(t.capacity_basis, ["pieces", "area"] as const, "capacity_basis"),
            truck_capacity: optInt(t.truck_capacity, "truck_capacity", 0, 100_000_000),
            rate_per_trip_paise: optInt(t.rate_per_trip_paise, "rate_per_trip", 0, MAX_PAISE),
            slabs: parseSlabs(t.slabs),
            free_above_paise: optInt(t.free_above_paise, "free_above", 0, MAX_PAISE),
            gst_bps: optInt(t.gst_bps, "transport gst", 0, 10_000),
          },
        }
      : {}),
    handling: h ? { per: oneOf(h.per, ["order", "trip"] as const, "handling per"), amount_paise: paise(h.amount_paise, "handling amount"), gst_bps: int(h.gst_bps, "handling gst", 0, 10_000) } : null,
    laying: l ? { rate_paise_per_area: paise(l.rate_paise_per_area, "laying rate"), gst_bps: int(l.gst_bps, "laying gst", 0, 10_000) } : null,
    ...(r.advance_bps === undefined ? {} : { advance_bps: int(r.advance_bps, "advance", 0, 10_000) }),
    ...(r.credit_days === undefined ? {} : { credit_days: int(r.credit_days, "credit_days", 0, 365) }),
    ...(r.validity_days === undefined ? {} : { validity_days: int(r.validity_days, "validity_days", 0, 365) }),
    ...(r.rounding_mode === undefined ? {} : { rounding_mode: oneOf(r.rounding_mode, ["half_up", "half_even", "down"] as const, "rounding") }),
  };
}

export function parsePolicy(json: unknown): PolicyOut {
  const r = rec(json, "policy answer");
  const c = r.current === null || r.current === undefined ? null : rec(r.current, "current policy");
  return {
    current: c ? { version_id: uuid(c.version_id, "version_id"), version_no: int(c.version_no, "version_no", 1, 100_000), effective_from: str(c.effective_from, "effective_from", 40), policy: parsePolicyBody(c.policy) } : null,
    versions: list(r.versions, "versions", 200).map((v) => {
      const x = rec(v, "version");
      return { version_id: uuid(x.version_id, "version_id"), version_no: int(x.version_no, "version_no", 1, 100_000), effective_from: str(x.effective_from, "effective_from", 40), created_at: iso(x.created_at, "created_at") };
    }),
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ quotes
export function parseQuoteLine(json: unknown): QuoteLineOut {
  const r = rec(json, "quote line");
  return {
    line_no: int(r.line_no, "line_no", 1, 200),
    catalogue_item_id: uuid(r.catalogue_item_id, "catalogue_item_id"),
    name: nstr(r.name, "name", 200),
    mode: oneOf(r.mode, ["area", "direct"] as const, "mode"),
    sold_per: unit(r.sold_per, "sold_per"),
    unit_price_paise: paise(r.unit_price_paise, "unit price"),
    gst_bps: int(r.gst_bps, "gst_bps", 0, 10_000),
    hsn: optStr(r.hsn, "hsn", 20),
    area_x100: optInt(r.area_x100, "area", 0, 100_000_000_000),
    area_unit: areaUnit(r.area_unit),
    pieces: optInt(r.pieces, "pieces", 0, 1_000_000_000),
    pallets: optInt(r.pallets, "pallets", 0, 100_000_000),
    delivered_area_x100: optInt(r.delivered_area_x100, "delivered area", 0, 100_000_000_000),
    billed_quantity: int(r.billed_quantity, "billed_quantity", 0, 1_000_000_000_000),
    material_paise: paise(r.material_paise, "material"),
    tax_paise: paise(r.tax_paise, "tax"),
  };
}

function quoteBase(r: Rec) {
  return {
    id: uuid(r.id, "id"),
    quote_no: int(r.quote_no, "quote_no", 1, 10_000_000),
    requirement_id: uuid(r.requirement_id, "requirement_id"),
    enquiry_id: uuid(r.enquiry_id, "enquiry_id"),
    lead_id: uuid(r.lead_id, "lead_id"),
    site_id: r.site_id === null || r.site_id === undefined ? null : uuid(r.site_id, "site_id"),
    status: oneOf(r.status, QUOTE_STATUSES, "status"),
    policy_version_id: uuid(r.policy_version_id, "policy_version_id"),
    engine_version: str(r.engine_version, "engine_version", 40),
    canonical_hash: str(r.canonical_hash, "canonical_hash", 128),
    as_of: str(r.as_of, "as_of", 40),
    valid_until: str(r.valid_until, "valid_until", 40),
    due_date: optStr(r.due_date, "due_date", 40),
    trips: int(r.trips, "trips", 0, 100_000),
    material_paise: paise(r.material_paise, "material"),
    transport_paise: paise(r.transport_paise, "transport"),
    handling_paise: paise(r.handling_paise, "handling"),
    laying_paise: paise(r.laying_paise, "laying"),
    tax_paise: paise(r.tax_paise, "tax"),
    total_paise: paise(r.total_paise, "total"),
    advance_paise: paise(r.advance_paise, "advance"),
    balance_paise: paise(r.balance_paise, "balance"),
    flags: list(r.flags, "flags", 20).map((f) => word(f, "flag")),
    needs_owner_approval: bool(r.needs_owner_approval, "needs_owner_approval"),
    created_at: iso(r.created_at, "created_at"),
    approved_at: optIso(r.approved_at, "approved_at"),
    rejected_at: optIso(r.rejected_at, "rejected_at"),
    reject_code: r.reject_code === null || r.reject_code === undefined ? null : oneOf(r.reject_code, REJECT_CODES, "reject_code"),
    lines: list(r.lines, "lines", 200).map(parseQuoteLine),
  };
}

export function parseQuote(json: unknown): MaterialQuoteOut {
  return quoteBase(rec(json, "quote"));
}

export function parseTrace(json: unknown) {
  return list(json ?? [], "trace", 400).map((t) => {
    const r = rec(t, "trace line");
    return { rule_id: word(r.rule_id, "rule_id", 80), inputs: isRecordLoose(r.inputs) ? (r.inputs as Record<string, unknown>) : {}, text: str(r.text, "trace text", 600) };
  });
}
const isRecordLoose = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseQuoteDetail(json: unknown): MaterialQuoteDetailOut {
  const r = rec(json, "quote");
  return { ...quoteBase(r), trace: parseTrace(r.trace) };
}

export function parseQuoteList(json: unknown): { items: MaterialQuoteOut[] } {
  const r = rec(json, "quote list");
  return { items: list(r.items, "items", 100).map(parseQuote) };
}

export function parseQuoteText(json: unknown): QuoteTextOut {
  const r = rec(json, "quote text");
  return { language: oneOf(r.language, LANGUAGES, "language"), language_review: oneOf(r.language_review, ["reviewed", "draft"] as const, "language_review"), text: str(r.text, "text", 8000) };
}

function parseCalcLine(json: unknown): CalcOut["lines"] extends (infer L)[] | undefined ? L : never {
  const r = rec(json, "calc line");
  return {
    sku: str(r.sku, "sku", 80),
    name: nstr(r.name, "name", 200),
    hsn: optStr(r.hsn, "hsn", 20),
    mode: oneOf(r.mode, ["area", "direct"] as const, "mode"),
    unit_price_paise: paise(r.unit_price_paise, "unit price"),
    gst_bps: int(r.gst_bps, "gst_bps", 0, 10_000),
    pieces: optInt(r.pieces, "pieces", 0, 1_000_000_000),
    pieces_without_wastage: optInt(r.pieces_without_wastage, "pieces_without_wastage", 0, 1_000_000_000),
    pallets: optInt(r.pallets, "pallets", 0, 100_000_000),
    delivered_area_x100: optInt(r.delivered_area_x100, "delivered_area", 0, 100_000_000_000),
    billed_quantity: int(r.billed_quantity, "billed_quantity", 0, 1_000_000_000_000),
    billed_per: unit(r.billed_per, "billed_per"),
    load: int(r.load, "load", 0, 1_000_000_000_000),
    material: paise(r.material, "material"),
    tax: paise(r.tax, "tax"),
    gross: paise(r.gross, "gross"),
  };
}

export function parseCalc(json: unknown): CalcOut {
  const r = rec(json, "calculation");
  const status = oneOf(r.status, ["draft", "rejected"] as const, "status");
  const f = rec(r.flags, "flags");
  const flags = {
    needs_owner_approval: bool(f.needs_owner_approval, "needs_owner_approval"),
    reasons: list(f.reasons, "reasons", 20).map((x) => {
      const q = rec(x, "reason");
      return { code: word(q.code, "code"), sku: optStr(q.sku, "sku", 80), exposure: optInt(q.exposure, "exposure", 0, MAX_PAISE * 10), credit_limit_paise: optInt(q.credit_limit_paise, "credit_limit", 0, MAX_PAISE), distance_km: q.distance_km === null || q.distance_km === undefined ? null : int(q.distance_km, "distance_km", 0, 10_000) };
    }),
  };
  const out: CalcOut = { status, engine_version: str(r.engine_version, "engine_version", 40), canonical_hash: optStr(r.canonical_hash, "canonical_hash", 128), flags };
  if (r.codes !== undefined) out.codes = list(r.codes, "codes", 40).map((c) => word(c, "code"));
  if (status === "draft") {
    out.lines = list(r.lines, "lines", 200).map(parseCalcLine);
    out.trips = optInt(r.trips, "trips", 0, 100_000);
    const t = rec(r.totals, "totals");
    out.totals = {
      material: paise(t.material, "material"), transport: paise(t.transport, "transport"), handling: paise(t.handling, "handling"), laying: paise(t.laying, "laying"), subtotal: paise(t.subtotal, "subtotal"),
      item_tax: paise(t.item_tax, "item_tax"), transport_tax: paise(t.transport_tax, "transport_tax"), handling_tax: paise(t.handling_tax, "handling_tax"), laying_tax: paise(t.laying_tax, "laying_tax"),
      tax: paise(t.tax, "tax"), total: paise(t.total, "total"),
    };
    const p = rec(r.payment_terms, "payment_terms");
    out.payment_terms = {
      advance_amount: paise(p.advance_amount, "advance"), balance: paise(p.balance, "balance"), credit_days: int(p.credit_days, "credit_days", 0, 365),
      due_date: optStr(p.due_date, "due_date", 40), balance_on: oneOf(p.balance_on, ["delivery", "credit_days"] as const, "balance_on"),
    };
    out.valid_until = optStr(r.valid_until, "valid_until", 40);
    if (r.range !== null && r.range !== undefined) {
      const g = rec(r.range, "range");
      out.range = { total_low: paise(g.total_low, "total_low"), total_high: paise(g.total_high, "total_high") };
    }
    out.trace = parseTrace(r.trace);
  }
  return out;
}

export function parsePreview(json: unknown): QuotePreviewOut {
  const r = rec(json, "preview");
  return { as_of: str(r.as_of, "as_of", 40), valid_until: str(r.valid_until, "valid_until", 40), result: parseCalc(r.result), database_agrees: bool(r.database_agrees, "database_agrees") };
}

export function parseDraft(json: unknown): { quote: MaterialQuoteOut; replayed: boolean } {
  const r = rec(json, "draft");
  return { quote: parseQuote(r.quote), replayed: r.replayed === true };
}

export function parseOrderCreated(json: unknown): OrderCreatedOut {
  const r = rec(json, "order");
  let credit: OrderCreatedOut["credit"] = null;
  if (r.credit !== null && r.credit !== undefined) {
    const c = rec(r.credit, "credit");
    credit = { credit_limit_paise: optInt(c.credit_limit_paise, "credit_limit", 0, MAX_PAISE), outstanding_paise: paise(c.outstanding_paise, "outstanding"), would_be_paise: paise(c.would_be_paise, "would_be"), exceeded: bool(c.exceeded, "exceeded") };
  }
  return { order_id: uuid(r.order_id, "order_id"), order_no: int(r.order_no, "order_no", 1, 10_000_000), state: word(r.state, "state"), replayed: r.replayed === true, credit };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------ requests
const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/materials/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};
const send = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** `GET /materials/items`: in the API's fixed order (in stock, few left, made to order, then by name). `includeInactive` is honoured for the Owner and Admin only. */
export async function listMaterialItems(accessToken: string, tenantId: string, opts: { inStock?: boolean; includeInactive?: boolean; after?: string | null; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 24) });
  if (opts.inStock) q.set("in_stock", "true");
  if (opts.includeInactive) q.set("include_inactive", "true");
  if (opts.after) q.set("after", opts.after);
  return parseItemList(await apiRequest(tenantPath(tenantId, `items?${q.toString()}`), accessToken));
}

export async function getMaterialItem(accessToken: string, tenantId: string, id: string) {
  return parseItem(await apiRequest(tenantPath(tenantId, `items/${idOf(id)}`), accessToken));
}

export type MaterialItemInput = { name: string; sellUnit: SellUnit; areaUnit: "sq_ft" | "sq_m" | null; stockStatus: StockStatus; active: boolean; price?: { paise: number } | { clear: true } };

/** `PUT /materials/items/{id}`: create or change; the same id again is a retry. Owner and Admin; the exact price is the Owner's alone... as the API decides. */
export async function putMaterialItem(accessToken: string, tenantId: string, id: string, input: MaterialItemInput) {
  const body: Record<string, unknown> = { name: input.name, sell_unit: input.sellUnit, area_unit: input.areaUnit, stock_status: input.stockStatus, active: input.active };
  if (input.price) body.price_paise = "clear" in input.price ? null : input.price.paise;
  return parseItemSaved(await apiRequest(tenantPath(tenantId, `items/${idOf(id)}`), accessToken, send("PUT", body)));
}

/** `POST /materials/items/{id}/photos?photo_id=`: the photo is the raw body with its own type; the same `photoId` is a retry. */
export async function uploadMaterialPhoto(accessToken: string, tenantId: string, itemId: string, photoId: string, body: ArrayBuffer | Blob, contentType: string) {
  if (!(PHOTO_TYPES as readonly string[]).includes(contentType)) throw new ApiContractError("type");
  return parsePhotoResult(await apiUploadRequest(tenantPath(tenantId, `items/${idOf(itemId)}/photos?photo_id=${idOf(photoId)}`), accessToken, body, contentType));
}

export async function removeMaterialPhoto(accessToken: string, tenantId: string, photoId: string) {
  return parseItem(await apiRequest(tenantPath(tenantId, `photos/${idOf(photoId)}/remove`), accessToken, send("POST")));
}

export async function reorderMaterialPhotos(accessToken: string, tenantId: string, itemId: string, photoIds: readonly string[]) {
  return parseItem(await apiRequest(tenantPath(tenantId, `items/${idOf(itemId)}/photos/order`), accessToken, send("PUT", { photo_ids: photoIds.map(idOf) })));
}

/** `GET /materials/policy`: the rules in force and the versions kept. Owner, Admin, Sales. */
export async function getMaterialPolicy(accessToken: string, tenantId: string) {
  return parsePolicy(await apiRequest(tenantPath(tenantId, "policy"), accessToken));
}

/** `POST /materials/policy`: a NEW version (the old stay); the same `versionId` is a retry. The Owner, with the second factor. */
export async function saveMaterialPolicy(accessToken: string, tenantId: string, versionId: string, policy: PolicyBody) {
  const r = rec(await apiRequest(tenantPath(tenantId, "policy"), accessToken, send("POST", { version_id: idOf(versionId), policy })), "saved policy");
  return { version_id: uuid(r.version_id, "version_id"), version_no: int(r.version_no, "version_no", 1, 100_000), effective_from: str(r.effective_from, "effective_from", 40), replayed: r.replayed === true };
}

type Pick = { line_no: number; item_id: string };
const picks = (p: readonly Pick[]) => p.map((x) => ({ line_no: x.line_no, item_id: idOf(x.item_id) }));

/** `POST /materials/requirements/{id}/preview`: the figures the database would use, run through the calculator. Nothing is stored. */
export async function previewMaterialQuote(accessToken: string, tenantId: string, requirementId: string, p: readonly Pick[], siteId?: string | null) {
  return parsePreview(await apiRequest(tenantPath(tenantId, `requirements/${idOf(requirementId)}/preview`), accessToken, send("POST", { picks: picks(p), ...(siteId ? { site_id: idOf(siteId) } : {}) })));
}

/** `POST /materials/requirements/{id}/quotes`: a draft, recomputed by the database; the same `quoteId` is a retry. */
export async function draftMaterialQuote(accessToken: string, tenantId: string, requirementId: string, quoteId: string, p: readonly Pick[], siteId?: string | null) {
  return parseDraft(await apiRequest(tenantPath(tenantId, `requirements/${idOf(requirementId)}/quotes`), accessToken, send("POST", { quote_id: idOf(quoteId), picks: picks(p), ...(siteId ? { site_id: idOf(siteId) } : {}) })));
}

export async function listMaterialQuotes(accessToken: string, tenantId: string, opts: { requirementId?: string; limit?: number } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 20) });
  if (opts.requirementId) q.set("requirement_id", idOf(opts.requirementId));
  return parseQuoteList(await apiRequest(tenantPath(tenantId, `quotes?${q.toString()}`), accessToken));
}

export async function getMaterialQuote(accessToken: string, tenantId: string, id: string) {
  return parseQuoteDetail(await apiRequest(tenantPath(tenantId, `quotes/${idOf(id)}`), accessToken));
}

/** `GET /materials/quotes/{id}/text`: the WhatsApp message in one language (every language but English is a draft until a person has read it). */
export async function getMaterialQuoteText(accessToken: string, tenantId: string, id: string, language: (typeof LANGUAGES)[number] = "en") {
  return parseQuoteText(await apiRequest(tenantPath(tenantId, `quotes/${idOf(id)}/text?language=${language}`), accessToken));
}

/** `POST /materials/quotes/{id}/approve`: Owner or Admin with the second factor; a flagged quote the Owner alone. A retry answers the approved quote. */
export async function approveMaterialQuote(accessToken: string, tenantId: string, id: string) {
  return parseQuote(await apiRequest(tenantPath(tenantId, `quotes/${idOf(id)}/approve`), accessToken, send("POST")));
}

export async function rejectMaterialQuote(accessToken: string, tenantId: string, id: string, code: RejectCode) {
  return parseQuote(await apiRequest(tenantPath(tenantId, `quotes/${idOf(id)}/reject`), accessToken, send("POST", { code })));
}

/** `POST /materials/quotes/{id}/order`: an order from an approved quote; the same `orderId` is a retry. Owner or Admin with the second factor. The answer carries a credit warning, never a block. */
export async function orderFromMaterialQuote(accessToken: string, tenantId: string, quoteId: string, orderId: string) {
  return parseOrderCreated(await apiRequest(tenantPath(tenantId, `quotes/${idOf(quoteId)}/order`), accessToken, send("POST", { order_id: idOf(orderId) })));
}
