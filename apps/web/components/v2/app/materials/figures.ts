import type { CalcOut, MaterialQuoteDetailOut, MaterialQuoteOut } from "@contracts";

/**
 * The figures of a material quote, in one shape whether they come from a preview (the calculator's answer) or from a stored quote: the lines with their measure and pieces and pallets, the totals, the payment
 * terms and the validity. Pure data; nothing here calculates a price, it only arranges numbers the engine and the database already agreed on.
 */
export type FigureLine = {
  name: string;
  soldPer: string;
  areaX100: number | null;
  areaUnit: "sq_ft" | "sq_m" | null;
  pieces: number | null;
  pallets: number | null;
  deliveredAreaX100: number | null;
  billedQuantity: number;
  unitPricePaise: number;
  gstBps: number;
  materialPaise: number;
  taxPaise: number;
};
export type Figures = {
  lines: FigureLine[];
  trips: number | null;
  materialPaise: number;
  transportPaise: number;
  handlingPaise: number;
  layingPaise: number;
  taxPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  balanceOn: "delivery" | "credit_days";
  creditDays: number;
  dueDate: string | null;
  validUntil: string | null;
  flags: string[];
  rangeLowPaise: number | null;
  rangeHighPaise: number | null;
};

/** From the calculator's answer for a preview. A rejected calculation has no figures (null). `areas` are the requirement's measures in line order, which the calculator does not echo back. */
export function figuresFromCalc(calc: CalcOut, areas: readonly ({ areaX100: number; areaUnit: "sq_ft" | "sq_m" | null } | null)[] = []): Figures | null {
  if (calc.status !== "draft" || !calc.totals || !calc.payment_terms || !calc.lines) return null;
  const t = calc.totals;
  const p = calc.payment_terms;
  return {
    lines: calc.lines.map((l, i) => ({
      name: l.name,
      soldPer: l.billed_per,
      areaX100: areas[i]?.areaX100 ?? null,
      areaUnit: areas[i]?.areaUnit ?? null,
      pieces: l.pieces,
      pallets: l.pallets,
      deliveredAreaX100: l.delivered_area_x100,
      billedQuantity: l.billed_quantity,
      unitPricePaise: l.unit_price_paise,
      gstBps: l.gst_bps,
      materialPaise: l.material,
      taxPaise: l.tax,
    })),
    trips: calc.trips ?? null,
    materialPaise: t.material,
    transportPaise: t.transport,
    handlingPaise: t.handling,
    layingPaise: t.laying,
    taxPaise: t.tax,
    totalPaise: t.total,
    advancePaise: p.advance_amount,
    balancePaise: p.balance,
    balanceOn: p.balance_on,
    creditDays: p.credit_days,
    dueDate: p.due_date,
    validUntil: calc.valid_until ?? null,
    flags: calc.flags.reasons.map((r) => r.code),
    rangeLowPaise: calc.range?.total_low ?? null,
    rangeHighPaise: calc.range?.total_high ?? null,
  };
}

/** From a stored quote (list row or detail). */
export function figuresFromQuote(q: MaterialQuoteOut | MaterialQuoteDetailOut): Figures {
  return {
    lines: q.lines.map((l) => ({
      name: l.name,
      soldPer: l.sold_per,
      areaX100: l.area_x100,
      areaUnit: l.area_unit,
      pieces: l.pieces,
      pallets: l.pallets,
      deliveredAreaX100: l.delivered_area_x100,
      billedQuantity: l.billed_quantity,
      unitPricePaise: l.unit_price_paise,
      gstBps: l.gst_bps,
      materialPaise: l.material_paise,
      taxPaise: l.tax_paise,
    })),
    trips: q.trips,
    materialPaise: q.material_paise,
    transportPaise: q.transport_paise,
    handlingPaise: q.handling_paise,
    layingPaise: q.laying_paise,
    taxPaise: q.tax_paise,
    totalPaise: q.total_paise,
    advancePaise: q.advance_paise,
    balancePaise: q.balance_paise,
    balanceOn: q.due_date ? "credit_days" : "delivery",
    creditDays: 0,
    dueDate: q.due_date,
    validUntil: q.valid_until,
    flags: q.flags,
    rangeLowPaise: null,
    rangeHighPaise: null,
  };
}

/** The flags that make a quote the Owner's alone to approve are named by the engine; these are the ones the screens have words for. */
export const FLAG_CODES = ["BELOW_MINIMUM_ORDER_QUANTITY", "CREDIT_LIMIT_EXCEEDED", "LINE_NOT_COUNTED_IN_TRIPS"] as const;
