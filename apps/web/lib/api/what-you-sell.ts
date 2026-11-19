import { ApiContractError, apiRequest } from "./client";
import { listCatalogueItems, parseItemSummary, type ItemBase, type Photo } from "./catalogue";
import { isCanonicalUuid } from "./crm";
import { listProgrammes } from "./education";
import { fetchLoadedPriceList } from "./pricelists";
import { bad, int, list, nstr, oneOf, optInt, optStr, readRows, rec, str, uuid } from "./shape";
import { liveSource, type LiveSource } from "@/lib/sell/style";
import {
  BOOKING_WORDS, PLACE_WORDS, PROPERTY_STATUSES, QTY_UNITS, SEAT_STATES, SELL_STYLES, SIZE_UNITS,
  type CourseEntry, type PriceEntry, type ProductEntry, type PropertyEntry, type SellData, type SellEntry, type SellStyle, type ServiceEntry, type StockState,
} from "@/lib/sell/types";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * THE ADAPTER of "What you sell" (C2, 19 Nov; JOBS). ONE file: every parser of a wire shape is here, so a contract change is an edit here. SERVER ONLY, with the signed-in person's own token. What each style is read from:
 *  - PRODUCTS: the REAL catalogue contract (`lib/api/catalogue.ts`, strict) plus ONE optional field the catalogue lacks, `stock_count` (a question for C1).
 *  - PRICE LISTS: the real "loaded price list" (`GET /price-lists/current`: its sample rows; the rate by quantity is the one the file has).
 *  - COURSES: the real programmes (`GET /programmes`) with their batches (the fee is not in that contract: a question for C1).
 *  - SERVICES, PROPERTIES (and the full courses and price lists): C2's PROPOSED `GET /what-you-sell?style=`, written in `~/Desktop/stack19-jobs/contracts/what-you-sell-web-needs.md` ("C2:" lines). Until C1 builds it the flag below is off and a real
 *    workspace is told "not ready yet"; JOBS=mock runs the made-up answers of `lib/sell/fixtures.ts` through the SAME parsers.
 * Closed words (stock, booking, place, status, size unit, quantity unit, seats) are checked; a row that does not fit is logged and LEFT OUT (never drawn half), a list that does not fit is an error.
 */
const MAX_ROWS = 200;

/** C1's `GET /what-you-sell` is not there yet (needs doc, question 2). Switching it on is this one word. */
const WHAT_YOU_SELL_LIVE = false;

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};
const paise = (v: unknown, what: string): number => int(v, what, 0, 1_000_000_000_000);
const day = (v: unknown, what: string): string | null => {
  const s = optStr(v, what, 40);
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s.slice(0, 10))) ? s.slice(0, 10) : bad(what);
};

/** The stock of a catalogue row: a count of 0 is "sold out", the catalogue's own words otherwise. */
export function stockOf(status: ItemBase["stock_status"], count: number | null): StockState {
  if (count === 0) return "sold_out";
  return status;
}

/** A row of the catalogue (`ItemSummary`, already checked by the catalogue's own parser) as a product. `stockCount` is the one extra field (null while C1 has none). */
export function productOf(row: ItemBase & { cover?: Photo | null }, stockCount: number | null = null): ProductEntry {
  return {
    style: "products",
    id: row.id,
    name: row.name,
    photo: row.cover?.thumb_url ?? row.cover?.url ?? null,
    pricePaise: row.price_paise,
    priceBand: row.price_band,
    colours: row.colours,
    stock: { state: stockOf(row.stock_status, stockCount), count: stockCount },
    keep: { fabric: row.fabric, zari: row.zari, border: row.border, occasions: row.occasions, active: row.active },
  };
}

export function parseProduct(row: unknown): ProductEntry {
  const x = rec(row, "product");
  return productOf(parseItemSummary(row), optInt(x.stock_count, "product.stock_count", 0, 1_000_000));
}
export function parseService(row: unknown): ServiceEntry {
  const x = rec(row, "service");
  return {
    style: "services",
    id: uuid(x.id, "service.id"),
    name: nstr(x.name, "service.name", 120),
    minutes: int(x.minutes, "service.minutes", 5, 1440),
    pricePaise: paise(x.price_paise, "service.price_paise"),
    priceFrom: x.price_from === true,
    booking: oneOf(x.booking, BOOKING_WORDS, "service.booking"),
    place: x.place === null || x.place === undefined ? null : oneOf(x.place, PLACE_WORDS, "service.place"),
  };
}
export function parseCourse(row: unknown): CourseEntry {
  const x = rec(row, "course");
  const seats = rec(x.seats, "course.seats");
  const state = oneOf(seats.state, SEAT_STATES, "course.seats.state");
  return {
    style: "courses",
    id: uuid(x.id, "course.id"),
    name: nstr(x.name, "course.name", 120),
    batch: str(x.batch, "course.batch", 120),
    startsOn: day(x.starts_on, "course.starts_on"),
    feePaise: x.fee_paise === null || x.fee_paise === undefined ? null : paise(x.fee_paise, "course.fee_paise"),
    seats: { state, count: state === "left" ? int(seats.count, "course.seats.count", 1, 100_000) : null },
    total: optInt(x.total, "course.total", 1, 100_000),
  };
}
export function parseProperty(row: unknown): PropertyEntry {
  const x = rec(row, "property");
  return {
    style: "properties",
    id: uuid(x.id, "property.id"),
    name: nstr(x.name, "property.name", 120),
    location: str(x.location, "property.location", 120),
    size: int(x.size, "property.size", 1, 10_000_000),
    sizeUnit: oneOf(x.size_unit, SIZE_UNITS, "property.size_unit"),
    note: optStr(x.note, "property.note", 120),
    pricePaise: paise(x.price_paise, "property.price_paise"),
    status: oneOf(x.status, PROPERTY_STATUSES, "property.status"),
  };
}
export function parsePrice(row: unknown): PriceEntry {
  const x = rec(row, "price item");
  const rates = list(x.rates, "price item.rates", 8).map((r) => {
    const o = rec(r, "price item.rate");
    return { fromQty: int(o.from_qty, "rate.from_qty", 1, 10_000_000), ratePaise: paise(o.rate_paise, "rate.rate_paise") };
  });
  if (rates.length === 0) bad("price item.rates");
  // bigger orders never cost more per piece, and the quantities go up (the same rule the price-list import keeps)
  for (let i = 1; i < rates.length; i++) if (rates[i].fromQty <= rates[i - 1].fromQty || rates[i].ratePaise > rates[i - 1].ratePaise) bad("price item.rates order");
  return { style: "pricelist", id: uuid(x.id, "price item.id"), name: nstr(x.name, "price item.name", 128), moq: int(x.moq, "price item.moq", 1, 10_000_000), unit: oneOf(x.unit, QTY_UNITS, "price item.unit"), rates, goodUntil: day(x.good_until, "price item.good_until") };
}

const ROW: { [S in SellStyle]: (row: unknown) => SellEntry } = { products: parseProduct, services: parseService, courses: parseCourse, properties: parseProperty, pricelist: parsePrice };

/** `{style, items: [...]}` of one style. The style the answer names must be the one asked for. */
export function parseSellList(json: unknown, style: SellStyle): SellEntry[] {
  const x = rec(json, "what you sell");
  if (oneOf(x.style, SELL_STYLES, "style") !== style) bad("style");
  return readRows(x.items, `what you sell (${style})`, ROW[style], MAX_ROWS);
}

/** A style the answer names that this build knows, else null (a newer API may add one; the pack map then decides). */
export function parseStyleWord(v: unknown): SellStyle | null {
  return typeof v === "string" && (SELL_STYLES as readonly string[]).includes(v) ? (v as SellStyle) : null;
}

/**
 * What the section reads. null = the screens are off. `unready` = nothing to read yet for this business (no API for its style): the section says so and links the old page. JOBS=mock: the made-up list of the style, through the same parsers
 * (`live: false`). A real read that fails is `unread` (the section says so; a rejected session is thrown by `apiRequest` as ever).
 */
export type SellRead = { state: "off" } | { state: "unready" } | { state: "unread" } | { state: "ready"; data: SellData };

export async function readWhatYouSell(token: string, tenantId: string, style: SellStyle, modules: readonly string[] | null): Promise<SellRead> {
  const mode = jobsScreens();
  if (mode === "off") return { state: "off" };
  if (mode === "mock") {
    const fx = await import("@/lib/sell/fixtures");
    const entries = parseSellList(fx.wireSell(style), style).map((e) => (e.style === "products" && e.photo !== null ? { ...e, photo: fx.mockPhoto(e.colours[0] ?? "multi") } : e));
    return { state: "ready", data: { style, entries, live: false } };
  }
  const t = base(tenantId);
  const source: LiveSource | null = liveSource(style, modules) ?? (WHAT_YOU_SELL_LIVE ? "what_you_sell" : null);
  if (!source) return { state: "unready" };
  try {
    if (source === "catalogue") {
      const page = await listCatalogueItems(token, tenantId, { limit: 50, includeInactive: true });
      return { state: "ready", data: { style, entries: page.items.map((i) => productOf(i)), live: true } };
    }
    if (source === "price_list") {
      const loaded = await fetchLoadedPriceList(token, tenantId);
      const rows = loaded.current?.sample ?? [];
      const entries: PriceEntry[] = rows.map((r) => ({
        style: "pricelist",
        id: r.sku,
        name: r.name,
        moq: Math.max(1, r.minimum_order_quantity),
        unit: r.sale_unit === "set" ? "set" : "piece",
        rates: [{ fromQty: Math.max(1, r.minimum_order_quantity), ratePaise: r.unit_price_paise }],
        goodUntil: null,
      }));
      return { state: "ready", data: { style, entries, live: true } };
    }
    if (source === "programmes") {
      const programmes = await listProgrammes(token, tenantId);
      const entries: CourseEntry[] = programmes.map((p) => ({
        style: "courses",
        id: p.id,
        name: p.name,
        batch: p.groups.map((g) => g.timing ?? g.label).slice(0, 2).join(", "),
        startsOn: null,
        feePaise: null,
        seats: { state: "open", count: null },
        total: null,
      }));
      return { state: "ready", data: { style, entries, live: true } };
    }
    return { state: "ready", data: { style, entries: parseSellList(await apiRequest(`${t}/what-you-sell?style=${style}`, token), style), live: true } };
  } catch {
    return { state: "unread" };
  }
}

/** What the assistant "understood" from photos or a sheet. JOBS=mock only (two made-up entries, nothing read from the picture); a real shop gets `null` and is pointed to the existing path (`ENTRY_PATH`) or told it is not ready. */
export async function readUnderstood(style: SellStyle, from: "photos" | "sheet"): Promise<SellEntry[] | null> {
  if (jobsScreens() !== "mock") return null;
  return parseSellList((await import("@/lib/sell/fixtures")).wireUnderstood(style, from), style);
}
