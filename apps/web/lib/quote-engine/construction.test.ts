// Job CN: the TypeScript twin of the construction calculator (packages/quote-engine/ts/construction.ts) must give EXACTLY the numbers of the Python reference. Both read the same golden vectors
// (packages/quote-engine/tests/fixtures/construction_vectors.json); pytest replays them against the reference, this file replays them against the twin. The hash is the server's own (the twin makes none).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calculate, canonicalJson, CONSTRUCTION_ENGINE_VERSION, formatRupees, type CalcRequest } from "../../../../packages/quote-engine/ts/construction";

type Vector = { name: string; request: CalcRequest; expected: Record<string, unknown> };
const file = path.resolve(import.meta.dirname, "../../../../packages/quote-engine/tests/fixtures/construction_vectors.json");
const doc = JSON.parse(readFileSync(file, "utf-8")) as { engine_version: string; vectors: Vector[] };

function withoutHash(x: Record<string, unknown>): Record<string, unknown> {
  const { canonical_hash: _ignored, ...rest } = x;
  return rest;
}

describe("construction calculator (TypeScript twin)", () => {
  it("names the same engine version as the vectors", () => {
    expect(doc.engine_version).toBe(CONSTRUCTION_ENGINE_VERSION);
    expect(doc.vectors.length).toBeGreaterThanOrEqual(40);
  });

  for (const v of doc.vectors) {
    it(`reproduces the vector: ${v.name}`, () => {
      const got = JSON.parse(JSON.stringify(calculate(structuredClone(v.request)))) as Record<string, unknown>;
      expect(got).toEqual(withoutHash(v.expected));
    });
  }

  it("works the 1,000 sq ft, 80 mm paver example by hand: 4,725 pieces, 10 pallets, 2 trips, Rs 88,795.00", () => {
    const v = doc.vectors.find((x) => x.name.startsWith("worked_example"))!;
    const out = calculate(structuredClone(v.request));
    if (out.status !== "draft") throw new Error("expected a draft");
    expect(out.lines[0].pieces_without_wastage).toBe(4500);
    expect(out.lines[0].pieces).toBe(4725);
    expect(out.lines[0].pallets).toBe(10);
    expect(out.trips).toBe(2);
    expect(out.totals.total).toBe(8879500);
    expect(formatRupees(out.totals.total)).toBe("₹88,795.00");
    expect(out.range).toEqual({ total_low: 8496000, total_high: 8879500 });
  });

  it("never lets a float or a boolean become a number", () => {
    const v = doc.vectors.find((x) => x.name.startsWith("worked_example"))!;
    const bad = structuredClone(v.request) as unknown as { lines: Record<string, unknown>[] };
    bad.lines[0].unit_price_paise = 65.5;
    expect(() => calculate(bad as unknown as CalcRequest)).toThrow(TypeError);
    const bad2 = structuredClone(v.request) as unknown as { lines: Record<string, unknown>[] };
    bad2.lines[0].area_x100 = true;
    expect(() => calculate(bad2 as unknown as CalcRequest)).toThrow(TypeError);
  });

  it("keeps every product exact beyond 2^53 (BigInt inside)", () => {
    const v = doc.vectors.find((x) => x.name === "intermediate_product_above_2_pow_53")!;
    const out = calculate(structuredClone(v.request));
    if (out.status !== "draft") throw new Error("expected a draft");
    // 99,999,999 x 9,000 x 10,500 / 10^9 = 9,449,999.9055 -> 9,450,000 pieces exactly (a float product would be off by a few units)
    expect(out.lines[0].pieces).toBe(9_450_000);
  });

  it("writes canonical JSON like Python (sorted keys, compact, ASCII)", () => {
    expect(canonicalJson({ b: [1, "é", null, true], a: { z: 0, y: "x " } })).toBe('{"a":{"y":"x\\u2028","z":0},"b":[1,"\\u00e9",null,true]}');
  });

  it("formats rupees with the lakh and crore grouping", () => {
    expect(formatRupees(0)).toBe("₹0.00");
    expect(formatRupees(99900)).toBe("₹999.00");
    expect(formatRupees(123456789)).toBe("₹12,34,567.89");
    expect(formatRupees(1000000000)).toBe("₹1,00,00,000.00");
    expect(formatRupees(-5)).toBe("-₹0.05");
  });
});
