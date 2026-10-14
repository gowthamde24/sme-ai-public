import { calculate, type CalcRequest } from "@quote-engine/construction";

/**
 * The public paver calculator's maths (job CM): the very calculator the app's quote builder uses (packages/quote-engine/ts/construction.ts, the TypeScript twin of the Python reference, pinned by golden vectors), asked
 * for a quantity. It is used twice with the same inputs: in the browser to show the result as the visitor types, and on the server to build the WhatsApp message, so a result is never taken from the browser.
 * No money rule is written here: a price is only passed through (the visitor's own), GST and transport are left out and the page says so.
 */
export type AreaUnit = "sq_ft" | "sq_m";
export type PaverProduct = { id: string; pieces_per_area_x1000: number; pieces_per_pallet: number };
export type PaverConfig = { products: readonly PaverProduct[]; default_wastage_bps: number; truck_capacity_pieces: number };
export type PaverInput = { productId: string; area: number; unit: AreaUnit; wastageBps?: number; pricePerUnit?: number | null };
export type PaverResult = { pieces: number; pieces_without_wastage: number; pallets: number; trips: number; delivered_area_x100: number; material_paise: number | null };

export const MAX_AREA = 100_000;
const SQFT_PER_SQM_X10000 = 107_639; // 10.7639 square feet in a square metre

/** The pieces per unit of area (thousandths) a product needs for the unit the visitor chose: the config is per square foot. */
export function piecesPerAreaX1000(product: PaverProduct, unit: AreaUnit): number {
  return unit === "sq_ft" ? product.pieces_per_area_x1000 : Math.round((product.pieces_per_area_x1000 * SQFT_PER_SQM_X10000) / 10_000);
}

/** The area as the engine wants it (hundredths of the unit), or null when it is not a usable number: between 1 and 100,000, at most two decimals. */
export function areaX100(area: number): number | null {
  if (!Number.isFinite(area) || area < 1 || area > MAX_AREA) return null;
  return Math.round(area * 100);
}

export function paverRequest(config: PaverConfig, input: PaverInput, asOf: string): CalcRequest | null {
  const product = config.products.find((p) => p.id === input.productId);
  const area = areaX100(input.area);
  if (!product || area === null) return null;
  const price = input.pricePerUnit && input.pricePerUnit > 0 ? Math.round(input.pricePerUnit * 100) : 0;
  return {
    as_of: asOf,
    customer: { outstanding_paise: 0 },
    lines: [{ sku: "PAVER", name: "Paver", mode: "area", sold_per: input.unit, unit_price_paise: price, gst_bps: 0, area_unit: input.unit, area_x100: area, pieces_per_area_x1000: piecesPerAreaX1000(product, input.unit), pieces_per_pallet: product.pieces_per_pallet }],
    policy: { default_wastage_bps: input.wastageBps ?? config.default_wastage_bps, round_to_pallet: false, bill_wastage: true, transport: { kind: "none", capacity_basis: "pieces", truck_capacity: config.truck_capacity_pieces }, advance_bps: 0, credit_days: 0, validity_days: 7, rounding_mode: "half_up" },
  };
}

/** The quantity, or null when the input is unusable or the engine refuses it. Never throws on a visitor's input. */
export function computePaver(config: PaverConfig, input: PaverInput, asOf: string): PaverResult | null {
  const request = paverRequest(config, input, asOf);
  if (!request) return null;
  let out;
  try {
    out = calculate(request);
  } catch {
    return null;
  }
  if (out.status !== "draft") return null;
  const line = out.lines[0];
  if (line.pieces === null || line.pallets === null || line.pieces_without_wastage === null || line.delivered_area_x100 === null) return null;
  return { pieces: line.pieces, pieces_without_wastage: line.pieces_without_wastage, pallets: line.pallets, trips: out.trips, delivered_area_x100: line.delivered_area_x100, material_paise: input.pricePerUnit && input.pricePerUnit > 0 ? out.totals.material : null };
}
