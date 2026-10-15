import { areaText, formatRupees, groupIndian, percentFromBps } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * One line of the calculator's own working in a person's words (job CO): "1,000 sq ft needs 4,725 pieces with the wastage added". The engine's trace carries the numbers it used (never text a model wrote); this only
 * puts them into a sentence of ours, in the person's language. A rule this code does not know yet is shown by its name, so a newer calculator is never hidden.
 */
export function traceSentence(rule: { rule_id: string; inputs: Record<string, unknown> }, words: TodayWords): string {
  const i = rule.inputs;
  const key = `mat.trace.${rule.rule_id}`;
  if (words[key] === undefined) return say(words, "mat.trace.other", { rule: rule.rule_id });
  switch (rule.rule_id) {
    case "quantity.area":
      return say(words, key, { area: areaText(n(i.area_x100)), without: groupIndian(n(i.pieces_without_wastage)), wastage: percentFromBps(n(i.wastage_bps)), pieces: groupIndian(n(i.pieces)), pallets: groupIndian(n(i.pallets)) });
    case "material.per_piece":
      return say(words, key, { qty: groupIndian(n(i.quantity)), rate: formatRupees(n(i.unit_price_paise)), amount: formatRupees(n(i.material)) });
    case "material.per_area":
      return say(words, key, { area: areaText(n(i.billed_area_x100)), rate: formatRupees(n(i.unit_price_paise)), amount: formatRupees(n(i.material)) });
    case "material.direct":
      return say(words, key, { qty: groupIndian(n(i.quantity_billed)), rate: formatRupees(n(i.unit_price_paise)), amount: formatRupees(n(i.material)) });
    case "quantity.minimum":
      return say(words, key, { qty: groupIndian(n(i.quantity)), min: groupIndian(n(i.minimum)) });
    case "tax.item":
      return say(words, key, { gst: percentFromBps(n(i.gst_bps)), amount: formatRupees(n(i.tax)) });
    case "trips":
      return say(words, key, { load: groupIndian(n(i.load)), capacity: groupIndian(n(i.capacity)), trips: groupIndian(n(i.trips)) });
    case "transport.per_trip":
      return say(words, key, { trips: groupIndian(n(i.trips)), rate: formatRupees(n(i.rate_per_trip_paise)), amount: formatRupees(n(i.transport)) });
    case "transport.km_slab":
      return say(words, key, { km: groupIndian(n(i.distance_km)), slab: groupIndian(n(i.up_to_km)), charge: formatRupees(n(i.charge_per_trip_paise)), trips: groupIndian(n(i.trips)), amount: formatRupees(n(i.transport)) });
    case "transport.free_above":
      return say(words, key, { limit: formatRupees(n(i.free_above_paise)) });
    case "handling":
      return say(words, key, { amount: formatRupees(n(i.handling)) });
    case "laying":
      return say(words, key, { area: areaText(n(i.area_x100)), rate: formatRupees(n(i.rate_paise_per_area)), amount: formatRupees(n(i.laying)) });
    case "credit.limit":
      return say(words, key, { outstanding: formatRupees(n(i.outstanding_paise)), balance: formatRupees(n(i.balance)) });
    case "payment.terms":
      return say(words, key, { advance: formatRupees(n(i.advance)), balance: formatRupees(n(i.balance)), days: groupIndian(n(i.credit_days)) });
    case "quote.validity":
      return say(words, key, { date: s(i.valid_until) });
    default:
      return say(words, "mat.trace.other", { rule: rule.rule_id });
  }
}
