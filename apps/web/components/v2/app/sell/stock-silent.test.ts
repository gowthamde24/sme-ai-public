import { describe, expect, it } from "vitest";

import type { SellEntry } from "@/lib/sell/types";

import { entryText } from "./sell-text";

const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k);
const product = (stock: { state: "in_stock" | "few_left" | "made_to_order" | "sold_out"; count: number | null }) =>
  ({ style: "products", id: "p", name: "Cream silk", colours: [], pricePaise: 780000, stock }) as unknown as SellEntry;

describe("a product's stock chip says only what is worth a look", () => {
  it("plain 'In stock' is silent; a count, few left, made to order and sold out still say so", () => {
    expect(entryText(t, product({ state: "in_stock", count: null })).chip).toBeNull();
    expect(entryText(t, product({ state: "in_stock", count: 50 })).chip).not.toBeNull();
    expect(entryText(t, product({ state: "few_left", count: null })).chip).not.toBeNull();
    expect(entryText(t, product({ state: "made_to_order", count: null })).chip).not.toBeNull();
    expect(entryText(t, product({ state: "sold_out", count: null })).chip).not.toBeNull();
  });
});
