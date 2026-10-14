// Pure construction-materials calculator, the TypeScript twin of packages/quote-engine/src/quote_engine/construction.py (job CN, ADR 0085). No dependencies, no clock, no network, no floats.
//
// The web (the quote builder, the preview) and the public paver calculator import THIS file; the API and the database compute the same numbers again before anything is stored. The three are kept equal by
// the golden vectors in packages/quote-engine/tests/fixtures/construction_vectors.json (run by pytest for the Python reference and by vitest for this file; a vector that differs in either fails the build).
//
// Money is integer paise, rates integer basis points, the area integer HUNDREDTHS of the unit (1,000 sq ft = 100000) and pieces per area unit integer THOUSANDTHS (4.5 = 4500). Every product is taken in
// BigInt so no intermediate value can lose a digit; inputs and outputs are plain numbers (all of them stay far below 2^53).
//
// A request the engine cannot use gives { status: "rejected", codes: [...] } and never throws, except for a value of the wrong type (a TypeError, as in Python).

export const CONSTRUCTION_ENGINE_VERSION = "1.0.0";

const MAX_AREA_X100 = 100_000_000;
const MAX_PIECES_PER_AREA_X1000 = 1_000_000;
const MAX_PIECES = 10_000_000;
const MAX_QUANTITY = 10_000_000;
const MAX_UNIT_PRICE = 100_000_000;
const MAX_SERVICE_AMOUNT = 100_000_000;
const MAX_BPS = 10_000;
const MAX_WASTAGE_BPS = 5_000;
const MAX_LINES = 20;
const MAX_SLABS = 10;
const MAX_KM = 5_000;
const MAX_CAPACITY = 1_000_000;
const MAX_CREDIT_DAYS = 180;
const MAX_VALIDITY_DAYS = 365;
const MAX_TOTAL = 1_000_000_000;
const MAX_ID = 128;
const MAX_MONEY_INPUT = 1_000_000_000;

export const SOLD_PER = ["piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"] as const;
export type SoldPer = (typeof SOLD_PER)[number];
export type AreaUnit = "sq_ft" | "sq_m";
const AREA_UNITS = ["sq_ft", "sq_m"];
const TRANSPORT_KINDS = ["none", "per_trip", "per_km_slab"];
const ROUNDING = ["half_up", "half_even", "down"];

export type CalcLine = {
  sku: string;
  name: string;
  mode: "area" | "direct";
  sold_per: SoldPer;
  unit_price_paise: number;
  gst_bps: number;
  hsn?: string | null;
  area_unit?: AreaUnit;
  area_x100?: number;
  pieces_per_area_x1000?: number;
  pieces_per_pallet?: number;
  quantity?: number;
  min_order_qty?: number;
  wastage_bps?: number;
  round_to_pallet?: boolean;
};

export type CalcTransport = {
  kind: "none" | "per_trip" | "per_km_slab";
  capacity_basis?: "pieces" | "area";
  truck_capacity?: number;
  rate_per_trip_paise?: number;
  slabs?: { up_to_km: number; charge_paise: number }[];
  free_above_paise?: number | null;
  gst_bps?: number;
};

export type CalcPolicy = {
  default_wastage_bps: number;
  round_to_pallet: boolean;
  bill_wastage: boolean;
  transport: CalcTransport;
  handling?: { per: "order" | "trip"; amount_paise: number; gst_bps: number };
  laying?: { rate_paise_per_area: number; gst_bps: number };
  advance_bps: number;
  credit_days: number;
  validity_days: number;
  rounding_mode: "half_up" | "half_even" | "down";
};

export type CalcRequest = {
  as_of: string;
  lines: CalcLine[];
  policy: CalcPolicy;
  customer: { outstanding_paise: number; credit_limit_paise?: number | null };
  laying?: boolean;
  distance_km?: number;
};

export type CalcFlag = { code: string; [key: string]: unknown };
export type CalcTrace = { rule_id: string; inputs: Record<string, unknown>; text: string };

export type CalcLineOut = {
  sku: string;
  name: string;
  hsn: string | null;
  mode: "area" | "direct";
  unit_price_paise: number;
  gst_bps: number;
  pieces: number | null;
  pieces_without_wastage: number | null;
  pallets: number | null;
  delivered_area_x100: number | null;
  billed_quantity: number;
  billed_per: SoldPer;
  load: number;
  material: number;
  tax: number;
  gross: number;
};

export type CalcDraft = {
  status: "draft";
  engine_version: string;
  lines: CalcLineOut[];
  trips: number;
  totals: {
    material: number;
    transport: number;
    handling: number;
    laying: number;
    subtotal: number;
    item_tax: number;
    transport_tax: number;
    handling_tax: number;
    laying_tax: number;
    tax: number;
    total: number;
  };
  payment_terms: { advance_amount: number; balance: number; credit_days: number; due_date: string | null; balance_on: "credit_days" | "delivery" };
  valid_until: string;
  flags: { needs_owner_approval: boolean; reasons: CalcFlag[] };
  trace: CalcTrace[];
  range: { total_low: number; total_high: number };
};

export type CalcRejection = {
  status: "rejected";
  codes: string[];
  engine_version: string;
  flags: { needs_owner_approval: boolean; reasons: CalcFlag[] };
  trace: CalcTrace[];
};

export type CalcResult = CalcDraft | CalcRejection;

class Invalid extends Error {}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------- canonical JSON (sorted keys, compact, ASCII), as Python's json.dumps(sort_keys, separators, ensure_ascii)
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypeError("Only integer JSON values are supported");
    return String(value);
  }
  if (typeof value === "string") return asciiString(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const o = value as Obj;
    return (
      "{" +
      Object.keys(o)
        .sort(compareCodePoints)
        .filter((k) => o[k] !== undefined)
        .map((k) => asciiString(k) + ":" + canonicalJson(o[k]))
        .join(",") +
      "}"
    );
  }
  throw new TypeError("Only integer JSON values are supported");
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asciiString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 8) out += "\\b";
    else if (c === 12) out += "\\f";
    else if (c === 10) out += "\\n";
    else if (c === 13) out += "\\r";
    else if (c === 9) out += "\\t";
    else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

// ---------------------------------------------------------------------------------------------- validation helpers
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function typed(v: unknown, kind: "object" | "array" | "string" | "boolean" | "integer"): void {
  const ok =
    kind === "object" ? isObj(v) : kind === "array" ? Array.isArray(v) : kind === "integer" ? typeof v === "number" && Number.isInteger(v) : typeof v === kind;
  if (!ok) throw new TypeError("Expected " + kind);
}

function fields(o: unknown, required: readonly string[], optional: readonly string[] = []): asserts o is Obj {
  typed(o, "object");
  const obj = o as Obj;
  const keys = Object.keys(obj);
  if (!required.every((k) => k in obj) || keys.some((k) => !required.includes(k) && !optional.includes(k))) throw new Invalid("INVALID_FIELDS");
}

function int(v: unknown, lo = 0, hi: number | null = null): number {
  typed(v, "integer");
  const n = v as number;
  if (n < lo || (hi !== null && n > hi)) throw new Invalid("OUT_OF_RANGE");
  return n;
}

function choice(v: unknown, choices: readonly string[]): string {
  typed(v, "string");
  if (!choices.includes(v as string)) throw new Invalid("INVALID_CHOICE");
  return v as string;
}

function text(v: unknown): string {
  typed(v, "string");
  const s = v as string;
  if (s === "" || [...s].length > MAX_ID) throw new Invalid("OUT_OF_RANGE");
  return s;
}

// n and d are never negative here; the ceiling of n/d
function cdiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d === 0n ? q : q + 1n;
}

function rounder(mode: string): (n: bigint, d: bigint) => bigint {
  return (n, d) => {
    const whole = n / d;
    const rem = n % d;
    if (mode === "down") return whole;
    const up = 2n * rem > d || (2n * rem === d && (mode === "half_up" || whole % 2n === 1n));
    return whole + (up ? 1n : 0n);
  };
}

function daysAfter(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2020 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && dt.toISOString().slice(0, 10) === s;
}

const num = (b: bigint): number => Number(b);

// ---------------------------------------------------------------------------------------------- validation
function validate(r: Obj): string {
  fields(r, ["as_of", "lines", "policy", "customer"], ["laying", "distance_km"]);
  typed(r.as_of, "string");
  const asOf = r.as_of as string;
  if (!validDate(asOf)) throw new Invalid("INVALID_DATE");
  if ("laying" in r) typed(r.laying, "boolean");
  if ("distance_km" in r) int(r.distance_km, 0, MAX_KM);
  typed(r.lines, "array");
  const lines = r.lines as unknown[];
  if (lines.length === 0) throw new Invalid("EMPTY_ORDER");
  if (lines.length > MAX_LINES) throw new Invalid("OUT_OF_RANGE");
  const skus = new Set<string>();
  for (const raw of lines) {
    if (isObj(raw) && !("gst_bps" in raw)) throw new Invalid("MISSING_GST_RATE");
    fields(
      raw,
      ["sku", "name", "mode", "sold_per", "unit_price_paise", "gst_bps"],
      ["hsn", "area_unit", "area_x100", "pieces_per_area_x1000", "pieces_per_pallet", "quantity", "min_order_qty", "wastage_bps", "round_to_pallet"],
    );
    const line = raw as Obj;
    if (skus.has(text(line.sku))) throw new Invalid("DUPLICATE_SKU");
    skus.add(line.sku as string);
    text(line.name);
    choice(line.mode, ["area", "direct"]);
    choice(line.sold_per, SOLD_PER);
    int(line.unit_price_paise, 0, MAX_UNIT_PRICE);
    int(line.gst_bps, 0, MAX_BPS);
    if ("hsn" in line && line.hsn !== null) {
      const hsn = text(line.hsn);
      if (!/^[0-9]+$/.test(hsn) || hsn.length < 4 || hsn.length > 8) throw new Invalid("INVALID_HSN");
    }
    if ("min_order_qty" in line) int(line.min_order_qty, 1, MAX_QUANTITY);
    if ("wastage_bps" in line) int(line.wastage_bps, 0, MAX_WASTAGE_BPS);
    if ("round_to_pallet" in line) typed(line.round_to_pallet, "boolean");
    if ("pieces_per_pallet" in line) int(line.pieces_per_pallet, 1, MAX_PIECES);
    if (line.mode === "area") {
      for (const key of ["area_unit", "area_x100", "pieces_per_area_x1000"]) if (!(key in line)) throw new Invalid("INVALID_FIELDS");
      if ("quantity" in line) throw new Invalid("INVALID_FIELDS");
      choice(line.area_unit, AREA_UNITS);
      int(line.area_x100, 1, MAX_AREA_X100);
      int(line.pieces_per_area_x1000, 1, MAX_PIECES_PER_AREA_X1000);
      if (line.sold_per !== "piece" && line.sold_per !== line.area_unit) throw new Invalid("INVALID_SOLD_PER");
    } else {
      if (!("quantity" in line)) throw new Invalid("INVALID_FIELDS");
      if (["area_unit", "area_x100", "pieces_per_area_x1000"].some((k) => k in line)) throw new Invalid("INVALID_FIELDS");
      int(line.quantity, 1, MAX_QUANTITY);
      if (AREA_UNITS.includes(line.sold_per as string)) throw new Invalid("INVALID_SOLD_PER");
    }
  }
  const units = new Set((lines as Obj[]).filter((l) => l.mode === "area").map((l) => l.area_unit as string));
  if (units.size > 1) throw new Invalid("MIXED_AREA_UNITS");
  validatePolicy(r.policy, units.size > 0);
  const c = r.customer;
  fields(c, ["outstanding_paise"], ["credit_limit_paise"]);
  int(c.outstanding_paise, 0, MAX_MONEY_INPUT);
  if (c.credit_limit_paise !== undefined && c.credit_limit_paise !== null) int(c.credit_limit_paise, 0, MAX_MONEY_INPUT);
  const p = r.policy as Obj;
  const span = Math.max(p.validity_days as number, p.credit_days as number);
  const [y, m, d] = asOf.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d) + span * 86_400_000).getUTCFullYear() > 9999) throw new Invalid("DATE_OVERFLOW");
  return asOf;
}

function validatePolicy(p: unknown, hasArea: boolean): void {
  fields(p, ["default_wastage_bps", "round_to_pallet", "bill_wastage", "transport", "advance_bps", "credit_days", "validity_days", "rounding_mode"], ["handling", "laying"]);
  int(p.default_wastage_bps, 0, MAX_WASTAGE_BPS);
  typed(p.round_to_pallet, "boolean");
  typed(p.bill_wastage, "boolean");
  int(p.advance_bps, 0, MAX_BPS);
  int(p.credit_days, 0, MAX_CREDIT_DAYS);
  int(p.validity_days, 0, MAX_VALIDITY_DAYS);
  choice(p.rounding_mode, ROUNDING);
  const t = p.transport;
  fields(t, ["kind"], ["capacity_basis", "truck_capacity", "rate_per_trip_paise", "slabs", "free_above_paise", "gst_bps"]);
  const kind = choice(t.kind, TRANSPORT_KINDS);
  if (kind === "none") {
    if (Object.keys(t).some((k) => !["kind", "capacity_basis", "truck_capacity"].includes(k)) || "capacity_basis" in t !== "truck_capacity" in t) throw new Invalid("INVALID_FIELDS");
    if ("capacity_basis" in t) {
      choice(t.capacity_basis, ["pieces", "area"]);
      int(t.truck_capacity, 1, MAX_CAPACITY);
    }
  } else {
    if (!("gst_bps" in t)) throw new Invalid("MISSING_GST_RATE");
    int(t.gst_bps, 0, MAX_BPS);
    if ("capacity_basis" in t) choice(t.capacity_basis, ["pieces", "area"]);
    if ("capacity_basis" in t !== "truck_capacity" in t) throw new Invalid("INVALID_FIELDS");
    if ("truck_capacity" in t) int(t.truck_capacity, 1, MAX_CAPACITY);
    if ("free_above_paise" in t && t.free_above_paise !== null) int(t.free_above_paise, 1, MAX_MONEY_INPUT);
    if (kind === "per_trip") {
      if (!("rate_per_trip_paise" in t) || !("truck_capacity" in t) || "slabs" in t) throw new Invalid("INVALID_FIELDS");
      int(t.rate_per_trip_paise, 0, MAX_SERVICE_AMOUNT);
    } else {
      if (!("slabs" in t) || "rate_per_trip_paise" in t) throw new Invalid("INVALID_FIELDS");
      typed(t.slabs, "array");
      const slabs = t.slabs as unknown[];
      if (slabs.length < 1 || slabs.length > MAX_SLABS) throw new Invalid("OUT_OF_RANGE");
      let previous = -1;
      for (const slab of slabs) {
        fields(slab, ["up_to_km", "charge_paise"]);
        if (int(slab.up_to_km, 0, MAX_KM) <= previous) throw new Invalid("INVALID_SLABS");
        previous = slab.up_to_km as number;
        int(slab.charge_paise, 0, MAX_SERVICE_AMOUNT);
      }
    }
    if (t.capacity_basis === "area" && !hasArea) throw new Invalid("INVALID_FIELDS");
  }
  if ("handling" in p) {
    const h = p.handling;
    fields(h, ["per", "amount_paise", "gst_bps"]);
    choice(h.per, ["order", "trip"]);
    int(h.amount_paise, 0, MAX_SERVICE_AMOUNT);
    int(h.gst_bps, 0, MAX_BPS);
  }
  if ("laying" in p) {
    const l = p.laying;
    fields(l, ["rate_paise_per_area", "gst_bps"]);
    int(l.rate_paise_per_area, 0, MAX_SERVICE_AMOUNT);
    int(l.gst_bps, 0, MAX_BPS);
  }
}

function sizeCheck(request: Obj): void {
  if (Object.keys(request).length > 8) throw new Invalid("OUT_OF_RANGE");
  if (Array.isArray(request.lines) && request.lines.length > MAX_LINES) throw new Invalid("OUT_OF_RANGE");
  const stack: [unknown, number][] = [[request, 0]];
  let count = 0;
  while (stack.length > 0) {
    const [value, depth] = stack.pop() as [unknown, number];
    count += 1;
    if (depth > 6 || count > 5_000) throw new Invalid("OUT_OF_RANGE");
    if (Array.isArray(value)) {
      if (value.length > 24) throw new Invalid("OUT_OF_RANGE");
      for (const v of value) stack.push([v, depth + 1]);
    } else if (isObj(value)) {
      const vals = Object.values(value);
      if (vals.length > 24) throw new Invalid("OUT_OF_RANGE");
      for (const v of vals) stack.push([v, depth + 1]);
    } else if (typeof value === "string" && [...value].length > MAX_ID) throw new Invalid("OUT_OF_RANGE");
    else if (typeof value === "number" && Math.abs(value) > 10 ** 12) throw new Invalid("OUT_OF_RANGE");
  }
}

function jsonTypes(value: unknown): void {
  // the same acceptance as canonicalJson, without building the text
  canonicalJson(value);
}

function rejection(codes: string[], flags: CalcFlag[], trace: CalcTrace[]): CalcRejection {
  return { status: "rejected", codes, engine_version: CONSTRUCTION_ENGINE_VERSION, flags: { needs_owner_approval: true, reasons: flags }, trace };
}

// ---------------------------------------------------------------------------------------------- the calculation
export function calculate(request: CalcRequest): CalcResult {
  const r = request as unknown as Obj;
  let asOf: string;
  try {
    jsonTypes(request);
    typed(request, "object");
    sizeCheck(r);
  } catch (e) {
    if (e instanceof Invalid) return rejection([e.message], [], []);
    throw e;
  }
  try {
    asOf = validate(r);
  } catch (e) {
    if (e instanceof Invalid) return rejection([e.message], [], []);
    throw e;
  }
  const out = run(request, asOf);
  if (out.status === "draft") out.range = estimate(request, asOf, out);
  return out as CalcResult;
}

function estimate(request: CalcRequest, asOf: string, exact: CalcDraft): { total_low: number; total_high: number } {
  const low = JSON.parse(JSON.stringify(request)) as CalcRequest;
  low.policy.default_wastage_bps = 0;
  low.policy.round_to_pallet = false;
  for (const line of low.lines) {
    if ("wastage_bps" in line) line.wastage_bps = 0;
    if ("round_to_pallet" in line) line.round_to_pallet = false;
  }
  const res = run(low, asOf);
  const lowTotal = res.status === "draft" ? res.totals.total : exact.totals.total;
  return { total_low: Math.min(lowTotal, exact.totals.total), total_high: exact.totals.total };
}

type Run = CalcDraft | CalcRejection;

function run(r: CalcRequest, asOf: string): Run {
  const p = r.policy;
  const rounded = rounder(p.rounding_mode);
  const flags: CalcFlag[] = [];
  const trace: CalcTrace[] = [];
  const flag = (code: string, numbers: Obj = {}) => {
    flags.push({ code, ...numbers });
  };
  const rule = (ruleId: string, numbers: Obj) => {
    trace.push({ rule_id: ruleId, inputs: numbers, text: ruleId + ": " + canonicalJson(numbers) });
  };
  const B = BigInt;
  const lines: CalcLineOut[] = [];
  let loadPieces = 0n;
  let loadAreaX100 = 0n;
  const uncounted: string[] = [];
  let orderedAreaX100 = 0n;
  let areaUnit: string | null = null;
  const basis = p.transport.capacity_basis ?? null;

  for (const src of r.lines) {
    const sku = src.sku;
    const wastage = src.wastage_bps ?? (src.mode === "area" ? p.default_wastage_bps : 0);
    let material: bigint;
    let minimumCheck: bigint;
    let lineLoad: bigint;
    let q: Omit<CalcLineOut, "sku" | "name" | "hsn" | "mode" | "unit_price_paise" | "gst_bps" | "load" | "material" | "tax" | "gross">;
    const price = B(src.unit_price_paise);
    if (src.mode === "area") {
      const a = B(src.area_x100 as number);
      const ppa = B(src.pieces_per_area_x1000 as number);
      areaUnit = src.area_unit as string;
      orderedAreaX100 += a;
      const basePieces = cdiv(a * ppa, 100_000n);
      let pieces = cdiv(a * ppa * B(MAX_BPS + wastage), 100_000n * B(MAX_BPS));
      let pallets: bigint | null = null;
      const ppp = src.pieces_per_pallet === undefined ? null : B(src.pieces_per_pallet);
      const usePallets = src.round_to_pallet ?? p.round_to_pallet;
      if (ppp !== null) {
        pallets = cdiv(pieces, ppp);
        if (usePallets) pieces = pallets * ppp;
      }
      if (pieces > B(MAX_PIECES)) return rejection(["OUT_OF_RANGE"], flags, trace);
      const deliveredAreaX100 = cdiv(pieces * 100_000n, ppa);
      rule("quantity.area", {
        sku, area_x100: num(a), pieces_per_area_x1000: num(ppa), wastage_bps: wastage, pieces_without_wastage: num(basePieces), pieces: num(pieces),
        pieces_per_pallet: ppp === null ? null : num(ppp), pallets: pallets === null ? null : num(pallets), pallet_rounding: Boolean(usePallets && ppp !== null),
        delivered_area_x100: num(deliveredAreaX100),
      });
      let billedQty: bigint;
      if (src.sold_per === "piece") {
        billedQty = pieces;
        material = pieces * price;
        rule("material.per_piece", { sku, quantity: num(pieces), unit_price_paise: src.unit_price_paise, material: num(material) });
      } else {
        const billedArea = p.bill_wastage ? deliveredAreaX100 : a;
        billedQty = billedArea;
        material = rounded(billedArea * price, 100n);
        rule("material.per_area", { sku, billed_area_x100: num(billedArea), bill_wastage: p.bill_wastage, unit_price_paise: src.unit_price_paise, material: num(material) });
      }
      minimumCheck = src.sold_per === "piece" ? pieces : cdiv(billedQty, 100n);
      lineLoad = pieces;
      loadPieces += pieces;
      loadAreaX100 += deliveredAreaX100;
      q = {
        pieces: num(pieces), pieces_without_wastage: num(basePieces), pallets: pallets === null ? null : num(pallets), delivered_area_x100: num(deliveredAreaX100),
        billed_quantity: num(billedQty), billed_per: src.sold_per,
      };
    } else {
      const qty = B(src.quantity as number);
      const billed = cdiv(qty * B(MAX_BPS + wastage), B(MAX_BPS));
      material = billed * price;
      rule("material.direct", { sku, quantity: num(qty), wastage_bps: wastage, quantity_billed: num(billed), unit_price_paise: src.unit_price_paise, material: num(material) });
      minimumCheck = billed;
      lineLoad = src.sold_per === "piece" ? billed : 0n;
      if (src.sold_per === "piece") loadPieces += billed;
      else uncounted.push(sku);
      q = {
        pieces: src.sold_per === "piece" ? num(billed) : null, pieces_without_wastage: null, pallets: null, delivered_area_x100: null, billed_quantity: num(billed), billed_per: src.sold_per,
      };
    }
    if (src.min_order_qty !== undefined) {
      rule("quantity.minimum", { sku, quantity: num(minimumCheck), minimum: src.min_order_qty });
      if (minimumCheck < B(src.min_order_qty)) flag("BELOW_MINIMUM_ORDER_QUANTITY", { sku });
    }
    const tax = rounded(material * B(src.gst_bps), B(MAX_BPS));
    rule("tax.item", { sku, material: num(material), gst_bps: src.gst_bps, tax: num(tax) });
    lines.push({
      sku, name: src.name, hsn: src.hsn ?? null, mode: src.mode, unit_price_paise: src.unit_price_paise, gst_bps: src.gst_bps, ...q, load: num(lineLoad), material: num(material),
      tax: num(tax), gross: num(material + tax),
    });
  }
  const materialTotal = lines.reduce((s, x) => s + BigInt(x.material), 0n);

  // trips and freight
  const t = p.transport;
  const capacity = t.truck_capacity ?? null;
  let trips = 1n;
  if (capacity !== null) {
    const load = basis === "pieces" ? loadPieces : loadAreaX100;
    const scaled = basis === "pieces" ? B(capacity) : B(capacity) * 100n;
    const need = cdiv(load, scaled);
    trips = need > 1n ? need : 1n;
    for (const sku of uncounted) flag("LINE_NOT_COUNTED_IN_TRIPS", { sku });
    rule("trips", { basis, load: num(load), capacity: num(scaled), trips: num(trips) });
  }
  let transport = 0n;
  if (t.kind === "per_trip") {
    transport = trips * B(t.rate_per_trip_paise as number);
    rule("transport.per_trip", { trips: num(trips), rate_per_trip_paise: t.rate_per_trip_paise as number, transport: num(transport) });
  } else if (t.kind === "per_km_slab") {
    const distance = r.distance_km;
    if (distance === undefined) return rejection(["DISTANCE_MISSING"], flags, trace);
    const slab = (t.slabs as { up_to_km: number; charge_paise: number }[]).find((s) => distance <= s.up_to_km);
    if (slab === undefined) {
      flag("DISTANCE_BEYOND_SLABS", { distance_km: distance });
      return rejection(["DISTANCE_BEYOND_SLABS"], flags, trace);
    }
    transport = trips * B(slab.charge_paise);
    rule("transport.km_slab", { distance_km: distance, up_to_km: slab.up_to_km, charge_per_trip_paise: slab.charge_paise, trips: num(trips), transport: num(transport) });
  }
  const freeAbove = t.free_above_paise ?? null;
  if (freeAbove !== null && t.kind !== "none") {
    const free = materialTotal > B(freeAbove);
    rule("transport.free_above", { material: num(materialTotal), free_above_paise: freeAbove, free });
    if (free) transport = 0n;
  }
  const transportTax = t.kind !== "none" ? rounded(transport * B(t.gst_bps as number), B(MAX_BPS)) : 0n;

  let handling = 0n;
  let handlingTax = 0n;
  if (p.handling !== undefined) {
    const h = p.handling;
    handling = B(h.amount_paise) * (h.per === "trip" ? trips : 1n);
    handlingTax = rounded(handling * B(h.gst_bps), B(MAX_BPS));
    rule("handling", { per: h.per, amount_paise: h.amount_paise, trips: num(trips), handling: num(handling), tax: num(handlingTax) });
  }

  let laying = 0n;
  let layingTax = 0n;
  if (r.laying === true) {
    if (p.laying === undefined || areaUnit === null) return rejection(["LAYING_RATE_MISSING"], flags, trace);
    laying = rounded(orderedAreaX100 * B(p.laying.rate_paise_per_area), 100n);
    layingTax = rounded(laying * B(p.laying.gst_bps), B(MAX_BPS));
    rule("laying", { area_x100: num(orderedAreaX100), rate_paise_per_area: p.laying.rate_paise_per_area, laying: num(laying), tax: num(layingTax) });
  }

  const itemTax = lines.reduce((s, x) => s + BigInt(x.tax), 0n);
  const tax = itemTax + transportTax + handlingTax + layingTax;
  const subtotal = materialTotal + transport + handling + laying;
  const total = subtotal + tax;
  if (total > B(MAX_TOTAL)) return rejection(["TOTAL_TOO_LARGE"], flags, trace);
  const advance = rounded(total * B(p.advance_bps), B(MAX_BPS));
  const balance = total - advance;
  const creditDays = p.credit_days;
  const due = creditDays > 0 ? daysAfter(asOf, creditDays) : null;
  const limit = r.customer.credit_limit_paise ?? null;
  const exposure = B(r.customer.outstanding_paise) + balance;
  if (limit !== null) {
    rule("credit.limit", { outstanding_paise: r.customer.outstanding_paise, balance: num(balance), credit_limit_paise: limit, exposure: num(exposure) });
    if (exposure > B(limit)) flag("CREDIT_LIMIT_EXCEEDED", { exposure: num(exposure), credit_limit_paise: limit });
  }
  const valid = daysAfter(asOf, p.validity_days);
  rule("payment.terms", { total: num(total), advance_bps: p.advance_bps, advance: num(advance), balance: num(balance), credit_days: creditDays, due_date: due });
  rule("quote.validity", { as_of: asOf, validity_days: p.validity_days, valid_until: valid });
  return {
    status: "draft",
    engine_version: CONSTRUCTION_ENGINE_VERSION,
    lines,
    trips: num(trips),
    totals: {
      material: num(materialTotal), transport: num(transport), handling: num(handling), laying: num(laying), subtotal: num(subtotal), item_tax: num(itemTax),
      transport_tax: num(transportTax), handling_tax: num(handlingTax), laying_tax: num(layingTax), tax: num(tax), total: num(total),
    },
    payment_terms: { advance_amount: num(advance), balance: num(balance), credit_days: creditDays, due_date: due, balance_on: creditDays > 0 ? "credit_days" : "delivery" },
    valid_until: valid,
    flags: { needs_owner_approval: true, reasons: flags },
    trace,
    range: { total_low: num(total), total_high: num(total) },
  };
}

// ---------------------------------------------------------------------------------------------- helpers the screens share
/** Rupees with the Indian grouping (lakh, crore) from integer paise: 8879500 -> "₹88,795.00". */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toString();
  const fraction = String(abs % 100).padStart(2, "0");
  let grouped: string;
  if (whole.length <= 3) grouped = whole;
  else {
    const head = whole.slice(0, -3);
    const tail = whole.slice(-3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return (negative ? "-" : "") + "₹" + grouped + "." + fraction;
}
