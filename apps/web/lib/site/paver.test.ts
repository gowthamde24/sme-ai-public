import { describe, expect, it } from "vitest";

import { calculate } from "@quote-engine/construction";

import { areaX100, computePaver, paverRequest, piecesPerAreaX1000, MAX_AREA, type PaverConfig } from "./paver";

const CONFIG: PaverConfig = {
  products: [
    { id: "rect", pieces_per_area_x1000: 4500, pieces_per_pallet: 500 },
    { id: "big", pieces_per_area_x1000: 1030, pieces_per_pallet: 120 },
  ],
  default_wastage_bps: 500,
  truck_capacity_pieces: 2500,
};
const DAY = "2026-10-14";

describe("the public paver calculator uses the app's own calculator (packages/quote-engine)", () => {
  it("gives the engine's worked example: 1,000 sq ft of a 4.5 per sq ft paver with 5% extra is 4,725 blocks, 10 pallets and 2 trips", () => {
    const r = computePaver(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft" }, DAY)!;
    expect(r).toMatchObject({ pieces: 4725, pieces_without_wastage: 4500, pallets: 10, trips: 2, delivered_area_x100: 105_000, material_paise: null });
  });
  it("is the very same answer as calling the engine directly (one code, no copy)", () => {
    const request = paverRequest(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft" }, DAY)!;
    const out = calculate(request);
    expect(out.status).toBe("draft");
    if (out.status === "draft") expect(out.lines[0].pieces).toBe(4725);
  });
  it("shows the material amount only when the visitor gave a price, and leaves GST and transport out", () => {
    const r = computePaver(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft", pricePerUnit: 65 }, DAY)!;
    expect(r.material_paise).toBe(6_825_000); // ₹65 for the 1,050 sq ft the blocks cover: ₹68,250.00, as in the engine's golden vector
    const request = paverRequest(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft", pricePerUnit: 65 }, DAY)!;
    expect(request.lines[0].gst_bps).toBe(0);
    expect(request.policy.transport.kind).toBe("none");
  });
  it("converts the pieces per square foot for square metres, and the wastage can be changed or switched off", () => {
    expect(piecesPerAreaX1000(CONFIG.products[0], "sq_ft")).toBe(4500);
    expect(piecesPerAreaX1000(CONFIG.products[0], "sq_m")).toBe(48_438); // 4.5 x 10.7639
    expect(computePaver(CONFIG, { productId: "rect", area: 100, unit: "sq_m" }, DAY)!.pieces).toBe(Math.ceil(48.438 * 100 * 1.05));
    expect(computePaver(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft", wastageBps: 0 }, DAY)!.pieces).toBe(4500);
  });
  it("refuses what it cannot use, and never throws on a visitor's input", () => {
    for (const area of [0, 0.5, -5, MAX_AREA + 1, Number.NaN, Number.POSITIVE_INFINITY]) expect(computePaver(CONFIG, { productId: "rect", area, unit: "sq_ft" }, DAY), String(area)).toBeNull();
    expect(computePaver(CONFIG, { productId: "nope", area: 100, unit: "sq_ft" }, DAY)).toBeNull();
    expect(computePaver(CONFIG, { productId: "rect", area: 100, unit: "sq_ft", wastageBps: 99_999 }, DAY)).toBeNull(); // the engine's own limit
    expect(computePaver(CONFIG, { productId: "rect", area: 100, unit: "sq_ft" }, "yesterday")).toBeNull();
  });
  it("takes an area of up to two decimals, between 1 and 100,000", () => {
    expect(areaX100(1)).toBe(100);
    expect(areaX100(12.345)).toBe(1235);
    expect(areaX100(MAX_AREA)).toBe(10_000_000);
    expect(areaX100(0.99)).toBeNull();
  });
  it("a bigger block needs fewer pieces", () => {
    expect(computePaver(CONFIG, { productId: "big", area: 1000, unit: "sq_ft" }, DAY)!.pieces).toBeLessThan(computePaver(CONFIG, { productId: "rect", area: 1000, unit: "sq_ft" }, DAY)!.pieces);
  });
});
