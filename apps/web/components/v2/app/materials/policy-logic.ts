import type { PolicyBody } from "@contracts";

import { percentFromBps, rupeesToPaise } from "@/lib/money";

/**
 * The owner's quote rules as a form holds them (job CO): percentages and rupees as typed text, converted to the basis points and paise the API takes, and back. Pure: it checks a number is a number within the
 * API's bounds and says which box is wrong; the API and the database check again. Nothing is assumed: a freight or laying line the owner leaves off is simply not in the policy, and a quote that needs it is refused
 * by the engine with its own reason.
 */
export type SlabText = { km: string; charge: string };
export type PolicyForm = {
  wastage: string;
  roundPallet: boolean;
  billWastage: boolean;
  transport: "none" | "per_trip" | "per_km_slab";
  basis: "pieces" | "area";
  capacity: string;
  ratePerTrip: string;
  slabs: SlabText[];
  freeAbove: string;
  transportGst: string;
  handling: "none" | "order" | "trip";
  handlingAmount: string;
  handlingGst: string;
  laying: boolean;
  layingRate: string;
  layingGst: string;
  advance: string;
  creditDays: string;
  validityDays: string;
};

export const MAX_SLABS = 10;
const rupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export function emptyForm(): PolicyForm {
  return { wastage: "5", roundPallet: false, billWastage: true, transport: "none", basis: "pieces", capacity: "", ratePerTrip: "", slabs: [{ km: "", charge: "" }], freeAbove: "", transportGst: "", handling: "none", handlingAmount: "", handlingGst: "", laying: false, layingRate: "", layingGst: "", advance: "50", creditDays: "0", validityDays: "7" };
}

export function formFromPolicy(p: PolicyBody | null | undefined): PolicyForm {
  const f = emptyForm();
  if (!p) return f;
  const t = p.transport;
  return {
    wastage: percentFromBps(p.default_wastage_bps ?? 500),
    roundPallet: p.round_to_pallet === true,
    billWastage: p.bill_wastage !== false,
    transport: t?.kind ?? "none",
    basis: t?.capacity_basis ?? "pieces",
    capacity: t?.truck_capacity == null ? "" : String(t.truck_capacity),
    ratePerTrip: rupees(t?.rate_per_trip_paise),
    slabs: t?.slabs && t.slabs.length > 0 ? t.slabs.map((s) => ({ km: String(s.up_to_km), charge: rupees(s.charge_paise) })) : f.slabs,
    freeAbove: rupees(t?.free_above_paise),
    transportGst: t?.gst_bps == null ? "" : percentFromBps(t.gst_bps),
    handling: p.handling ? p.handling.per : "none",
    handlingAmount: p.handling ? rupees(p.handling.amount_paise) : "",
    handlingGst: p.handling ? percentFromBps(p.handling.gst_bps) : "",
    laying: p.laying != null,
    layingRate: p.laying ? rupees(p.laying.rate_paise_per_area) : "",
    layingGst: p.laying ? percentFromBps(p.laying.gst_bps) : "",
    advance: percentFromBps(p.advance_bps ?? 5000),
    creditDays: String(p.credit_days ?? 0),
    validityDays: String(p.validity_days ?? 7),
  };
}

export const bpsFromText = (text: string, max = 10_000): number | null => {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= max ? bps : null;
};
const wholeText = (text: string, min: number, max: number): number | null => {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};
const MAX_RUPEES = 100_000_000_000;

export type PolicyResult = { ok: true; policy: PolicyBody } | { ok: false; field: keyof PolicyForm | "slabs" };

export function policyFromForm(f: PolicyForm): PolicyResult {
  const wastage = bpsFromText(f.wastage, 5000);
  if (wastage === null) return { ok: false, field: "wastage" };
  const advance = bpsFromText(f.advance);
  if (advance === null) return { ok: false, field: "advance" };
  const credit = wholeText(f.creditDays, 0, 180);
  if (credit === null) return { ok: false, field: "creditDays" };
  const validity = wholeText(f.validityDays, 0, 365);
  if (validity === null) return { ok: false, field: "validityDays" };
  const body: PolicyBody = { default_wastage_bps: wastage, round_to_pallet: f.roundPallet, bill_wastage: f.billWastage, advance_bps: advance, credit_days: credit, validity_days: validity, rounding_mode: "half_up" };
  if (f.transport !== "none") {
    const gst = bpsFromText(f.transportGst);
    if (gst === null) return { ok: false, field: "transportGst" };
    const capacity = wholeText(f.capacity, 1, 1_000_000);
    if (capacity === null) return { ok: false, field: "capacity" };
    const free = f.freeAbove.trim() === "" ? null : rupeesToPaise(f.freeAbove, 1_000_000_000);
    if (free !== null && free < 1) return { ok: false, field: "freeAbove" };
    if (f.freeAbove.trim() !== "" && free === null) return { ok: false, field: "freeAbove" };
    if (f.transport === "per_trip") {
      const rate = rupeesToPaise(f.ratePerTrip, MAX_RUPEES);
      if (rate === null) return { ok: false, field: "ratePerTrip" };
      body.transport = { kind: "per_trip", capacity_basis: f.basis, truck_capacity: capacity, rate_per_trip_paise: rate, gst_bps: gst, ...(free !== null ? { free_above_paise: free } : {}) };
    } else {
      const rows = f.slabs.filter((s) => s.km.trim() !== "" || s.charge.trim() !== "");
      if (rows.length < 1 || rows.length > MAX_SLABS) return { ok: false, field: "slabs" };
      const slabs: { up_to_km: number; charge_paise: number }[] = [];
      for (const r of rows) {
        const km = wholeText(r.km, 1, 5000);
        const charge = rupeesToPaise(r.charge, MAX_RUPEES);
        if (km === null || charge === null) return { ok: false, field: "slabs" };
        slabs.push({ up_to_km: km, charge_paise: charge });
      }
      if (slabs.some((s, i) => i > 0 && s.up_to_km <= slabs[i - 1].up_to_km)) return { ok: false, field: "slabs" };
      body.transport = { kind: "per_km_slab", capacity_basis: f.basis, truck_capacity: capacity, slabs, gst_bps: gst, ...(free !== null ? { free_above_paise: free } : {}) };
    }
  } else body.transport = { kind: "none" };
  if (f.handling !== "none") {
    const amount = rupeesToPaise(f.handlingAmount, MAX_RUPEES);
    if (amount === null) return { ok: false, field: "handlingAmount" };
    const gst = bpsFromText(f.handlingGst);
    if (gst === null) return { ok: false, field: "handlingGst" };
    body.handling = { per: f.handling, amount_paise: amount, gst_bps: gst };
  }
  if (f.laying) {
    const rate = rupeesToPaise(f.layingRate, MAX_RUPEES);
    if (rate === null) return { ok: false, field: "layingRate" };
    const gst = bpsFromText(f.layingGst);
    if (gst === null) return { ok: false, field: "layingGst" };
    body.laying = { rate_paise_per_area: rate, gst_bps: gst };
  }
  return { ok: true, policy: body };
}
