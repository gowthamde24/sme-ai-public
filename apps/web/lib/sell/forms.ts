import { COLOURS, MAX_COLOURS, MAX_NAME, MAX_PRICE_PAISE, MIN_PRICE_PAISE, type PriceBand } from "@/lib/api/catalogue";
import type { SaveInput } from "@/components/v2/app/catalogue/catalogue-types";

import { bigMoneyText, countNumber, dayFromShort, parseBigMoney, wholeNumber } from "./text";
import type {
  CourseEntry, PriceEntry, ProductEntry, PropertyEntry, SellEntry, SellForm, SellStyle, ServiceEntry,
} from "./types";

/**
 * The sheet's choices and the entry they make (pure: the sheet checks as the owner goes, the server action checks again with the same function, so what is saved is what was shown). A refusal is a CODE and the field it is about; the sentence is `jobs.sell.err.<code>`.
 */
export type Refusal = { ok: false; code: "name" | "price" | "minutes" | "colours" | "count" | "fee" | "seats" | "size" | "moq" | "rates" | "day"; field: string };
export type Built<E extends SellEntry> = { ok: true; entry: E } | Refusal;
const no = (code: Refusal["code"], field: string): Refusal => ({ ok: false, code, field });

const trimmed = (s: string, max: number): string | null => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= max ? t : null;
};
/** Rupees typed as "8,500" or "8500.50" to paise (₹1 to ₹10,00,000, the catalogue's own limits), or null. */
export function rupeesOf(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const p = Math.round(Number(t) * 100);
  return p >= MIN_PRICE_PAISE && p <= MAX_PRICE_PAISE ? p : null;
}

/** The catalogue's price band of an exact price, the way its bands are named (the API keeps a band for everyone, the exact price only for the Owner). */
export function bandOfPaise(paise: number): PriceBand {
  if (paise < 500_000) return "under_5k";
  if (paise < 1_000_000) return "5k_10k";
  if (paise < 2_500_000) return "10k_25k";
  if (paise < 5_000_000) return "25k_50k";
  return "above_50k";
}

export const EMPTY: { [S in SellStyle]: SellForm[S] } = {
  products: { name: "", price: "", colours: [], stock: "in_stock", count: "" },
  services: { name: "", minutes: "30", price: "", priceFrom: false, booking: "any_day", place: "" },
  courses: { name: "", batch: "", startsOn: "", fee: "", seats: "" },
  properties: { name: "", location: "", size: "", sizeUnit: "sq_ft", price: "", status: "available", note: "" },
  pricelist: { name: "", moq: "", unit: "piece", rates: [{ fromQty: "", rate: "" }], goodUntil: "" },
};

const plain = (paise: number): string => String(paise / 100);
/** The form of an entry about to be changed. */
export function formOf<S extends SellStyle>(entry: Extract<SellEntry, { style: S }>): SellForm[S];
export function formOf(entry: SellEntry): SellForm[SellStyle] {
  switch (entry.style) {
    case "products":
      return { name: entry.name, price: entry.pricePaise === null ? "" : plain(entry.pricePaise), colours: entry.colours, stock: entry.stock.state === "sold_out" ? "in_stock" : entry.stock.state, count: entry.stock.count === null ? "" : String(entry.stock.count) };
    case "services":
      return { name: entry.name, minutes: String(entry.minutes), price: plain(entry.pricePaise), priceFrom: entry.priceFrom, booking: entry.booking, place: entry.place ?? "" };
    case "courses":
      return { name: entry.name, batch: entry.batch, startsOn: dayFromShort(entry.startsOn), fee: entry.feePaise === null ? "" : plain(entry.feePaise), seats: entry.total === null ? "" : String(entry.total) };
    case "properties":
      return { name: entry.name, location: entry.location, size: String(entry.size), sizeUnit: entry.sizeUnit, price: bigMoneyText(entry.pricePaise).replace("₹", ""), status: entry.status, note: entry.note ?? "" };
    case "pricelist":
      return { name: entry.name, moq: String(entry.moq), unit: entry.unit, rates: entry.rates.map((r) => ({ fromQty: String(r.fromQty), rate: plain(r.ratePaise) })), goodUntil: dayFromShort(entry.goodUntil) };
  }
}

/** Turns the choices into the entry (`prior` = the entry being changed: what the sheet does not ask keeps its value). */
export function buildProduct(id: string, f: SellForm["products"], prior: ProductEntry | null, ownerPrice: boolean): Built<ProductEntry> {
  const name = trimmed(f.name, MAX_NAME);
  if (!name) return no("name", "name");
  const paise = f.price.trim() === "" ? null : rupeesOf(f.price);
  if (f.price.trim() !== "" && paise === null) return no("price", "price");
  if (f.colours.length < 1 || f.colours.length > MAX_COLOURS || new Set(f.colours).size !== f.colours.length || !f.colours.every((c) => (COLOURS as readonly string[]).includes(c))) return no("colours", "colours");
  const count = f.count.trim() === "" ? null : countNumber(f.count);
  if (f.count.trim() !== "" && count === null) return no("count", "count");
  // the exact price is the Owner's; an Admin's typed price only chooses the band the catalogue keeps for everyone
  const band: PriceBand = paise !== null ? bandOfPaise(paise) : prior?.priceBand ?? "10k_25k";
  return {
    ok: true,
    entry: {
      style: "products",
      id,
      name,
      photo: prior?.photo ?? null,
      pricePaise: ownerPrice && paise !== null ? paise : prior?.pricePaise ?? null,
      priceBand: band,
      colours: f.colours,
      stock: { state: count === 0 ? "sold_out" : f.stock, count },
      keep: prior?.keep ?? { fabric: "kanchi_pattu", zari: "none", border: null, occasions: [], active: false },
    },
  };
}
export function buildService(id: string, f: SellForm["services"]): Built<ServiceEntry> {
  const name = trimmed(f.name, 120);
  if (!name) return no("name", "name");
  const minutes = wholeNumber(f.minutes, 1440);
  if (minutes === null || minutes < 5) return no("minutes", "minutes");
  const price = rupeesOf(f.price);
  if (price === null) return no("price", "price");
  return { ok: true, entry: { style: "services", id, name, minutes, pricePaise: price, priceFrom: f.priceFrom, booking: f.booking, place: f.place === "" ? null : f.place } };
}
export function buildCourse(id: string, f: SellForm["courses"], prior: CourseEntry | null = null): Built<CourseEntry> {
  const name = trimmed(f.name, 120);
  if (!name) return no("name", "name");
  const batch = trimmed(f.batch, 120);
  if (!batch) return no("name", "batch");
  const fee = rupeesOf(f.fee);
  if (fee === null) return no("fee", "fee");
  const total = f.seats.trim() === "" ? null : wholeNumber(f.seats, 100_000);
  if (f.seats.trim() !== "" && total === null) return no("seats", "seats");
  if (f.startsOn.trim() !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(f.startsOn.trim()) || Number.isNaN(Date.parse(f.startsOn.trim())))) return no("day", "startsOn");
  return { ok: true, entry: { style: "courses", id, name, batch, startsOn: f.startsOn.trim() === "" ? null : f.startsOn.trim(), feePaise: fee, seats: prior && prior.total === total ? prior.seats : total === null ? { state: "open", count: null } : { state: "left", count: total }, total } };
}
export function buildProperty(id: string, f: SellForm["properties"]): Built<PropertyEntry> {
  const name = trimmed(f.name, 120);
  if (!name) return no("name", "name");
  const location = trimmed(f.location, 120);
  if (!location) return no("name", "location");
  const size = wholeNumber(f.size, 10_000_000);
  if (size === null) return no("size", "size");
  const price = parseBigMoney(f.price);
  if (price === null) return no("price", "price");
  const note = f.note.trim() === "" ? null : trimmed(f.note, 120);
  return { ok: true, entry: { style: "properties", id, name, location, size, sizeUnit: f.sizeUnit, note, pricePaise: price, status: f.status } };
}
export function buildPrice(id: string, f: SellForm["pricelist"]): Built<PriceEntry> {
  const name = trimmed(f.name, 128);
  if (!name) return no("name", "name");
  const moq = wholeNumber(f.moq, 10_000_000);
  if (moq === null) return no("moq", "moq");
  const rates: PriceEntry["rates"] = [];
  for (const r of f.rates) {
    if (r.fromQty.trim() === "" && r.rate.trim() === "") continue;
    const q = wholeNumber(r.fromQty, 10_000_000);
    const p = parseBigMoney(r.rate);
    if (q === null || p === null) return no("rates", "rates");
    rates.push({ fromQty: q, ratePaise: p });
  }
  if (rates.length === 0 || rates.length > 8) return no("rates", "rates");
  for (let i = 1; i < rates.length; i++) if (rates[i].fromQty <= rates[i - 1].fromQty || rates[i].ratePaise > rates[i - 1].ratePaise) return no("rates", "rates");
  if (rates[0].fromQty < moq) return no("rates", "rates");
  if (f.goodUntil.trim() !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(f.goodUntil.trim()) || Number.isNaN(Date.parse(f.goodUntil.trim())))) return no("day", "goodUntil");
  return { ok: true, entry: { style: "pricelist", id, name, moq, unit: f.unit, rates, goodUntil: f.goodUntil.trim() === "" ? null : f.goodUntil.trim() } };
}

/** One entry out of the form of any style. */
export function buildEntry(style: SellStyle, id: string, form: SellForm[SellStyle], prior: SellEntry | null, ownerPrice: boolean): Built<SellEntry> {
  switch (style) {
    case "products":
      return buildProduct(id, form as SellForm["products"], prior?.style === "products" ? prior : null, ownerPrice);
    case "services":
      return buildService(id, form as SellForm["services"]);
    case "courses":
      return buildCourse(id, form as SellForm["courses"], prior?.style === "courses" ? prior : null);
    case "properties":
      return buildProperty(id, form as SellForm["properties"]);
    case "pricelist":
      return buildPrice(id, form as SellForm["pricelist"]);
  }
}

/**
 * THE PAYLOAD OF A PRODUCT: exactly what the old catalogue form sends to `saveItemAction` (components/v2/app/catalogue/ItemEditor.tsx): the whole item, `active` as it is (a new saree is not shown until it has a photo), and the exact price only when the Owner typed one.
 * What the sheet does not ask (fabric, zari, border, occasions) is carried from the item (a new one gets the old form's own defaults).
 */
export function productSaveInput(entry: ProductEntry, owner: boolean, typedPrice: string): SaveInput {
  const paise = typedPrice.trim() === "" ? null : rupeesOf(typedPrice);
  return {
    name: entry.name,
    fabric: entry.keep.fabric,
    colours: entry.colours,
    zari: entry.keep.zari,
    border: entry.keep.border,
    occasions: entry.keep.occasions,
    priceBand: entry.priceBand,
    stockStatus: entry.stock.state === "sold_out" ? "in_stock" : entry.stock.state,
    active: entry.keep.active,
    ...(owner && paise !== null ? { price: { rupees: paise / 100 } } : {}),
  };
}
