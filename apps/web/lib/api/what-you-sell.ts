import { randomUUID } from "node:crypto";

import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { listCatalogueItems, parseItemSummary, type ItemBase, type Photo } from "./catalogue";
import { isCanonicalUuid } from "./crm";
import { listProgrammes } from "./education";
import { fetchLoadedPriceList } from "./pricelists";
import { bad, int, list, nstr, oneOf, optInt, optStr, readRows, rec, str, uuid } from "./shape";
import { liveSource, type LiveSource } from "@/lib/sell/style";
import {
  BOOKING_WORDS, NOTE_CODES, PLACE_WORDS, PROPERTY_STATUSES, QTY_UNITS, SEAT_STATES, SELL_STYLES, SIZE_UNITS,
  type CourseEntry, type PriceEntry, type ProductEntry, type PropertyEntry, type SellData, type SellEntry, type SellNote, type SellStyle, type ServiceEntry, type StockState,
} from "@/lib/sell/types";
import { jobsScreens } from "@/lib/screens/flag";
import { previewMine, previewSample } from "@/lib/screens/preview";

/**
 * THE ADAPTER of "What you sell" (C2; JOBS; C1's FINAL contract 1.1 part 1, sections 3 and 8). ONE file: every parser of a wire shape is here, so a contract change is an edit here. SERVER ONLY, with the signed-in person's own token. What each style is read from:
 *  - PRODUCTS: the catalogue routes (`lib/api/catalogue.ts`, strict) plus `stock_count` (null = not counted, 0 = sold out, n = "n in stock").
 *  - SERVICES, COURSES, PROPERTIES, PRICE LISTS: `GET /what-you-sell?style=&limit=50&cursor=` -> `{style, items, next_cursor}` (a style that is not the workspace's is an empty list, never an error). ONLY an HTTP 404 means "not there yet": then the loaded price list
 *    and the programmes (the old routes) stand in where the business type has them, else the section says "not ready". Any other refusal is "could not be read", as ever.
 *  - WRITES: `PUT /what-you-sell/{style}/{id}` (the whole entry; the SAME id again is a retry: the sheet mints the id once per opening) and `POST .../{id}/remove`. `style=products` is never sent (the catalogue's own save is used).
 *  - THE READING CALL: `POST /what-you-sell/{style}/read {kind: photo|sheet|talk, file_id?, text?, language}` -> `{style, drafts[], unclear, notes[]}` (at most 20 drafts, nothing saved; a draft without a price has `price_paise: null` and a note).
 * JOBS=mock runs the made-up answers of `lib/sell/fixtures.ts` through the SAME parsers. Closed words are checked; a row that does not fit is logged and LEFT OUT (never drawn half), a list that does not fit is an error.
 */
const MAX_ROWS = 200;
/** The API pages 50 an answer; the section follows `next_cursor` for 4 answers (200 items) and says so when the list is longer. */
const PAGE = 50;
/** At most this many drafts come back from one reading (C1, W4). */
export const MAX_DRAFTS = 20;

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
  if (count === 0 || status === "out_of_stock") return "sold_out";
  return status;
}

/** A row of the catalogue (`ItemSummary`, already checked by the catalogue's own parser) as a product. `stock_count`: null = not counted (In stock / Few left from the item's own flag), 0 = sold out, n = "n in stock". */
export function productOf(row: ItemBase & { cover?: Photo | null }, stockCountArg?: number | null): ProductEntry {
  // the count the catalogue row carries (`stock_count`, contract 1.1 part 1) unless the caller knows better (a save that just wrote one)
  const stockCount = stockCountArg !== undefined ? stockCountArg : row.stock_count ?? null;
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
    // 5 minutes to 24 hours, or null (a membership has no fixed time)
    minutes: optInt(x.minutes, "service.minutes", 5, 1440),
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
    // `count` only with "left" (whole, at least 1); `total` a whole number or null
    seats: { state, count: state === "left" ? int(seats.count, "course.seats.count", 1, 100_000) : null },
    total: optInt(x.total, "course.total", 1, 100_000),
    description: optStr(x.description, "course.description", 200),
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
    note: optStr(x.note, "property.note", 200),
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
  return { style: "pricelist", id: uuid(x.id, "price item.id"), name: nstr(x.name, "price item.name", 120), moq: int(x.moq, "price item.moq", 1, 10_000_000), unit: oneOf(x.unit, QTY_UNITS, "price item.unit"), rates, goodUntil: day(x.good_until, "price item.good_until") };
}

const ROW: { [S in SellStyle]: (row: unknown) => SellEntry } = { products: parseProduct, services: parseService, courses: parseCourse, properties: parseProperty, pricelist: parsePrice };

/** `{style, items: [...]}` of one style. The style the answer names must be the one asked for. */
export function parseSellList(json: unknown, style: SellStyle): SellEntry[] {
  return parseSellPage(json, style).entries;
}

/** One answer of `GET /what-you-sell?style=&limit=&cursor=`: `{style, items, next_cursor}` (at most 50 items; `next_cursor` is a short word or null). */
export function parseSellPage(json: unknown, style: SellStyle): { entries: SellEntry[]; next: string | null } {
  const x = rec(json, "what you sell");
  if (oneOf(x.style, SELL_STYLES, "style") !== style) bad("style");
  const cursor = x.next_cursor;
  if (cursor !== null && cursor !== undefined && (typeof cursor !== "string" || cursor === "" || cursor.length > 400)) bad("next_cursor");
  return { entries: readRows(x.items, `what you sell (${style})`, ROW[style], MAX_ROWS), next: typeof cursor === "string" ? cursor : null };
}

/** A style the answer names that this build knows, else null (a newer API may add one; the pack map then decides). */
export function parseStyleWord(v: unknown): SellStyle | null {
  return typeof v === "string" && (SELL_STYLES as readonly string[]).includes(v) ? (v as SellStyle) : null;
}

/* ---- the reading call (W4): drafts, nothing saved ---- */

/** A draft is an entry without an id (the web gives it one, so a retry of Save sends the same id) and, when no price was stated, `price_paise: null` (never guessed). */
function parseDraft(style: SellStyle, row: unknown, id: string): SellEntry {
  const x: Record<string, unknown> = { ...rec(row, "draft"), id };
  if (style === "services") {
    const e = parseService({ ...x, booking: x.booking ?? "any_day", price_paise: x.price_paise ?? 0 });
    return x.price_paise === null || x.price_paise === undefined ? { ...e, pricePaise: null } : e;
  }
  if (style === "properties") {
    const e = parseProperty({ ...x, size_unit: x.size_unit ?? "sq_ft", status: x.status ?? "available", location: x.location ?? "", price_paise: x.price_paise ?? 0 });
    return x.price_paise === null || x.price_paise === undefined ? { ...e, pricePaise: null } : e;
  }
  if (style === "courses") return parseCourse({ ...x, batch: x.batch ?? "", seats: x.seats ?? { state: "open" } });
  if (style === "pricelist") {
    // a rate without a price is left out (the owner types it); the quantity word and the smallest order the draft did not state are the plain ones
    const rates = (Array.isArray(x.rates) ? x.rates : []).filter((r) => isRecord(r) && r.rate_paise !== null && r.rate_paise !== undefined);
    const moq = x.moq ?? 1;
    const e = parsePrice({ ...x, unit: x.unit ?? "piece", moq, rates: rates.length > 0 ? rates : [{ from_qty: moq, rate_paise: 0 }] });
    return rates.length > 0 ? e : { ...e, rates: [] };
  }
  return bad("draft style");
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type SellReading = { entries: SellEntry[]; unclear: boolean; notes: SellNote[] };
/** `{style, drafts[], unclear, notes[{code, row?}]}`: at most 20 drafts; a draft the web cannot read is left out, a note with a code the web has no sentence for is left out (never shown as a raw code). */
export function parseSellReading(json: unknown, style: SellStyle): SellReading {
  const x = rec(json, "reading");
  if (oneOf(x.style, SELL_STYLES, "style") !== style) bad("style");
  const entries: SellEntry[] = [];
  for (const row of list(x.drafts, "drafts", MAX_DRAFTS)) {
    try {
      entries.push(parseDraft(style, row, randomUUID()));
    } catch (e) {
      console.error("API what you sell: a draft is not the contract's shape and is left out:", e instanceof Error ? e.message : String(e));
    }
  }
  const notes: SellNote[] = [];
  for (const n of Array.isArray(x.notes) ? x.notes.slice(0, 40) : []) {
    if (!isRecord(n) || !(NOTE_CODES as readonly unknown[]).includes(n.code)) continue;
    notes.push({ code: n.code as SellNote["code"], row: typeof n.row === "number" && Number.isSafeInteger(n.row) && n.row >= 1 && n.row <= MAX_DRAFTS ? n.row : null });
  }
  return { entries, unclear: x.unclear === true, notes };
}

/** What a write sends: the whole entry (never the id: it is in the path), closed words and whole paise. Products are never sent (the catalogue routes are theirs). */
export function wireOfEntry(e: SellEntry): Record<string, unknown> {
  switch (e.style) {
    case "services":
      return { name: e.name, minutes: e.minutes, price_paise: e.pricePaise, price_from: e.priceFrom, booking: e.booking, place: e.place };
    case "courses":
      return { name: e.name, batch: e.batch, starts_on: e.startsOn, fee_paise: e.feePaise, seats: e.seats.state === "left" ? { state: "left", count: e.seats.count } : { state: e.seats.state }, total: e.total, description: e.description ?? null };
    case "properties":
      return { name: e.name, location: e.location, size: e.size, size_unit: e.sizeUnit, note: e.note, price_paise: e.pricePaise, status: e.status };
    case "pricelist":
      return { name: e.name, moq: e.moq, unit: e.unit, rates: e.rates.map((r) => ({ from_qty: r.fromQty, rate_paise: r.ratePaise })), good_until: e.goodUntil };
    case "products":
      return bad("products are saved through the catalogue");
  }
}

const sellPath = (tenantId: string, style: SellStyle, tail = ""): string => {
  if (style === "products") bad("products are not written here");
  return `${base(tenantId)}/what-you-sell/${style}${tail}`;
};
const entryId = (id: string): string => (isCanonicalUuid(id) ? id : bad("entry id"));

/** `PUT /what-you-sell/{style}/{id}`: the whole entry (Owner and Admin; the same id again is a retry, never a second row). A price, fee or rate change may answer `403 mfa_required`. The answer is the entry as stored when it is one, else the one sent. */
export async function putSellEntry(token: string, tenantId: string, entry: SellEntry): Promise<SellEntry> {
  const answer = await apiRequest(sellPath(tenantId, entry.style, `/${entryId(entry.id)}`), token, { method: "PUT", body: JSON.stringify(wireOfEntry(entry)) });
  try {
    const stored = ROW[entry.style](isRecord(answer) && isRecord(answer.item) ? answer.item : answer);
    return stored.id === entry.id ? stored : entry;
  } catch {
    return entry;
  }
}
/** `POST /what-you-sell/{style}/{id}/remove` (soft remove; the API has no HTTP DELETE). */
export async function removeSellEntry(token: string, tenantId: string, style: SellStyle, id: string): Promise<void> {
  await apiRequest(sellPath(tenantId, style, `/${entryId(id)}/remove`), token, { method: "POST", body: "{}" });
}

/** What goes to the reading call: a photo or a sheet the owner already dropped (`fileId` of the assistant's file route), or the owner's own words (at most 2000 characters); `language` is the language of those words. */
export type ReadInput = { kind: "photo" | "sheet"; fileId: string } | { kind: "talk"; text: string };
export const READ_LANGUAGES = ["en", "te", "hi", "kn", "ta", "ml"] as const;
/** `POST /what-you-sell/{style}/read`: costs one assistant run (the 30-an-hour limit). Nothing is saved. */
export async function readSellDrafts(token: string, tenantId: string, style: SellStyle, input: ReadInput, language: string): Promise<SellReading> {
  const lang = (READ_LANGUAGES as readonly string[]).includes(language) ? language : "en";
  const body: Record<string, unknown> = input.kind === "talk" ? { kind: "talk", text: input.text.slice(0, 2000), language: lang } : { kind: input.kind, file_id: uuid(input.fileId, "file id"), language: lang };
  return parseSellReading(await apiRequest(sellPath(tenantId, style, "/read"), token, { method: "POST", body: JSON.stringify(body) }), style);
}

/**
 * What the section reads. null = the screens are off. `unready` = nothing to read yet for this business (the route answers 404 and no old route stands in): the section says so and links the old page. JOBS=mock: the made-up list of the style, through the same parsers
 * (`live: false`). A real read that fails is `unread` (the section says so; a rejected session is thrown by `apiRequest` as ever).
 */
export type SellRead = { state: "off" } | { state: "unready" } | { state: "unread" } | { state: "ready"; data: SellData };

/** The lists are read 50 an answer (the API's limit), following `next_cursor` like the old catalogue pages, up to 4 answers = 200 items (`MAX_ROWS`); a longer list is cut and the page says so (`SellData.cut`). */
const PAGES = 4;

/** `admin` = Owner or Admin: only they may ask for the switched-off items too (the old catalogue and materials pages do the same); Sales and Viewer see the items that are on. */
export async function readWhatYouSell(token: string, tenantId: string, style: SellStyle, modules: readonly string[] | null, admin: boolean): Promise<SellRead> {
  const mode = jobsScreens();
  if (mode === "off") return { state: "off" };
  if (mode === "mock") {
    const fx = await import("@/lib/sell/fixtures");
    const entries = parseSellList(fx.wireSell(style, previewSample()), style).map((e) => (e.style === "products" && e.photo !== null ? { ...e, photo: fx.mockPhoto(e.colours[0] ?? "multi") } : e));
    return { state: "ready", data: { style, entries, live: false } };
  }
  const t = base(tenantId);
  // the staging preview, "my business" (lib/screens/preview.ts): where the route is not there yet and no old route stands in, the sample list of this style (the saree shop's), marked as such, instead of "not ready"
  const unready = async (): Promise<SellRead> => {
    if (!previewMine()) return { state: "unready" };
    const fx = await import("@/lib/sell/fixtures");
    const entries = parseSellList(fx.wireSell(style), style).map((e) => (e.style === "products" && e.photo !== null ? { ...e, photo: fx.mockPhoto(e.colours[0] ?? "multi") } : e));
    return { state: "ready", data: { style, entries, live: false, sample: true } };
  };
  try {
    if (style === "products") {
      if (liveSource(style, modules) !== "catalogue") return unready();
      const entries: SellEntry[] = [];
      let after: string | null = null;
      let cut = false;
      for (let n = 0; n < PAGES; n++) {
        const page: Awaited<ReturnType<typeof listCatalogueItems>> = await listCatalogueItems(token, tenantId, { limit: PAGE, includeInactive: admin, ...(after ? { after } : {}) });
        entries.push(...page.items.map((i) => productOf(i)));
        after = page.next_cursor;
        if (!after) break;
        if (n === PAGES - 1) cut = true;
      }
      return { state: "ready", data: { style, entries, live: true, ...(cut ? { cut } : {}) } };
    }
    // C1's route first; ONLY a 404 means "not there yet" (then the old routes stand in where the business type has them)
    try {
      const entries: SellEntry[] = [];
      let after: string | null = null;
      let cut = false;
      for (let n = 0; n < PAGES; n++) {
        const q = new URLSearchParams({ style, limit: String(PAGE), ...(after ? { cursor: after } : {}) });
        const page = parseSellPage(await apiRequest(`${t}/what-you-sell?${q.toString()}`, token), style);
        entries.push(...page.entries);
        after = page.next;
        if (!after) break;
        if (n === PAGES - 1) cut = true;
      }
      return { state: "ready", data: { style, entries: entries.slice(0, MAX_ROWS), live: true, ...(cut ? { cut } : {}) } };
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 404)) throw error;
    }
    const source: LiveSource | null = liveSource(style, modules);
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
    return unready();
  } catch {
    return { state: "unread" };
  }
}

/** What the assistant "understood" from photos or a sheet. JOBS=mock only (two made-up entries, nothing read from the picture); a real shop uses the reading call (`readSellDrafts`). */
export async function readUnderstood(style: SellStyle, from: "photos" | "sheet"): Promise<SellEntry[] | null> {
  if (jobsScreens() !== "mock") return null;
  return parseSellList((await import("@/lib/sell/fixtures")).wireUnderstood(style, from, previewSample()), style);
}
