import { COLOURS, FABRICS, OCCASIONS, PRICE_BANDS, type Colour, type Fabric, type Item, type ItemFilters, type ItemSummary, type Occasion, type PriceBand } from "@/lib/api/catalogue";

/**
 * The catalogue's list page, as pure functions (job BC): what the address asks for, which of it the API does and which the page does, how an item is badged and priced, how a photo is moved. No React, no
 * request. The API filters by fabric, colour, occasion, price band and "in stock" (in stock or few left); it has no name search and cannot pick "few left" or "made to order" alone, so the page does those on
 * the items it has read (the same trade the Outbox makes: the newest items of the list, up to MAX_SCANNED).
 */
export const STOCK_CHOICES = ["available", "few_left", "made_to_order"] as const;
export type StockChoice = (typeof STOCK_CHOICES)[number];

export type CatalogueQuery = {
  q: string;
  fabric: Fabric | null;
  colours: Colour[];
  occasions: Occasion[];
  bands: PriceBand[];
  stock: StockChoice | null;
};

export const EMPTY_QUERY: CatalogueQuery = { q: "", fabric: null, colours: [], occasions: [], bands: [], stock: null };

/** Items the page reads at most when it has to filter itself (4 requests of 50). */
export const MAX_SCANNED = 200;
export const PAGE_SIZE = 24;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
function words<T extends string>(v: string | string[] | undefined, allowed: readonly T[], max: number): T[] {
  const out: T[] = [];
  for (const w of first(v).split(",")) {
    const t = w.trim() as T;
    if ((allowed as readonly string[]).includes(t) && !out.includes(t) && out.length < max) out.push(t);
  }
  return out;
}

/** The query as the address carries it. Anything that is not a word of the closed lists is dropped, never passed on. */
export function parseQuery(raw: Raw): CatalogueQuery {
  const fabric = first(raw.fabric);
  const stock = first(raw.stock);
  return {
    q: first(raw.q).trim().slice(0, 100),
    fabric: (FABRICS as readonly string[]).includes(fabric) ? (fabric as Fabric) : null,
    colours: words(raw.colour, COLOURS, 4),
    occasions: words(raw.occasion, OCCASIONS, 4),
    bands: words(raw.band, PRICE_BANDS, 5),
    stock: (STOCK_CHOICES as readonly string[]).includes(stock) ? (stock as StockChoice) : null,
  };
}

/** The address of the list for a query. `lead` (the customer a saree is being chosen for) is kept so the choice carries on to the saree's page. */
export function hrefFor(base: string, q: CatalogueQuery, extra: { lead?: string | null; after?: string | null } = {}): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.fabric) p.set("fabric", q.fabric);
  if (q.colours.length) p.set("colour", q.colours.join(","));
  if (q.occasions.length) p.set("occasion", q.occasions.join(","));
  if (q.bands.length) p.set("band", q.bands.join(","));
  if (q.stock) p.set("stock", q.stock);
  if (extra.lead) p.set("lead", extra.lead);
  if (extra.after) p.set("after", extra.after);
  const s = p.toString();
  return s ? `${base}/catalogue?${s}` : `${base}/catalogue`;
}

/** The same query with one choice turned on or off (a chip). */
export function toggled(q: CatalogueQuery, kind: "fabric" | "colour" | "occasion" | "band" | "stock", value: string): CatalogueQuery {
  const flip = <T extends string>(list: readonly T[], v: T, max: number): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(-max));
  switch (kind) {
    case "fabric":
      return { ...q, fabric: q.fabric === value ? null : (value as Fabric) };
    case "stock":
      return { ...q, stock: q.stock === value ? null : (value as StockChoice) };
    case "colour":
      return { ...q, colours: flip(q.colours, value as Colour, 4) };
    case "occasion":
      return { ...q, occasions: flip(q.occasions, value as Occasion, 4) };
    case "band":
      return { ...q, bands: flip(q.bands, value as PriceBand, 5) };
  }
}

/** How many kinds of filter are on (the number on the "Filters" button): the search word is not one, it has its own box. */
export function activeFilters(q: CatalogueQuery): number {
  return (q.fabric ? 1 : 0) + (q.colours.length ? 1 : 0) + (q.occasions.length ? 1 : 0) + (q.bands.length ? 1 : 0) + (q.stock ? 1 : 0);
}
export const isFiltered = (q: CatalogueQuery): boolean => q.q !== "" || activeFilters(q) > 0;

/** What the API is asked. Owner and Admin also read the hidden items (the API ignores the flag for anyone else). */
export function apiFilters(q: CatalogueQuery, admin: boolean): ItemFilters {
  return {
    ...(q.fabric ? { fabric: q.fabric } : {}),
    ...(q.colours.length ? { colours: q.colours } : {}),
    ...(q.occasions.length ? { occasions: q.occasions } : {}),
    ...(q.bands.length ? { priceBands: q.bands } : {}),
    ...(q.stock === "available" || q.stock === "few_left" ? { inStock: true } : {}),
    ...(admin ? { includeInactive: true } : {}),
  };
}

/** True when the page must look at more than one API page to fill a screen, because it narrows by itself. */
export const narrowsItself = (q: CatalogueQuery): boolean => q.q !== "" || q.stock === "few_left" || q.stock === "made_to_order";

const fold = (s: string) => s.toLocaleLowerCase("en-IN").normalize("NFKD").replace(/\p{M}/gu, "");

/** The page's own narrowing: the name search (name, border and fabric, every word of the search must be there) and the stock choices the API cannot make. */
export function narrow(items: readonly ItemSummary[], q: CatalogueQuery): ItemSummary[] {
  const terms = fold(q.q).split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (q.stock === "few_left" && i.stock_status !== "few_left") return false;
    if (q.stock === "made_to_order" && i.stock_status !== "made_to_order") return false;
    if (terms.length === 0) return true;
    const hay = fold(`${i.name} ${i.border ?? ""} ${i.fabric_label}`);
    return terms.every((t) => hay.includes(t));
  });
}

/** The badge a card carries. A hidden item is marked first (only Owner and Admin ever see one). */
export type Badge = "inactive" | "few_left" | "made_to_order";
export function badgesOf(i: Pick<ItemSummary, "active" | "stock_status">): Badge[] {
  const out: Badge[] = [];
  if (!i.active) out.push("inactive");
  if (i.stock_status === "few_left") out.push("few_left");
  if (i.stock_status === "made_to_order") out.push("made_to_order");
  return out;
}

/** The price line: the exact price when the Owner set one (money text from the API, English), else the band as the API words it. */
export const priceOf = (i: Pick<ItemSummary, "price_text" | "price_band_label">): string => i.price_text ?? i.price_band_label;

/** `list` with the entry at `from` moved to `to` (both clamped); the same list when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return [...list];
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(target, 0, it);
  return next;
}

/** The cover first: moves the photo at `index` to the front. */
export const makeCover = <T,>(list: readonly T[], index: number): T[] => moveItem(list, index, 0);

/** The smallest `expires_in_seconds` on a page: when the links must be fetched again (a link is good for that long from the moment the page was drawn). */
export function soonestExpiry(items: readonly Pick<Item, "photos">[] | readonly Pick<ItemSummary, "cover">[]): number | null {
  const seconds: number[] = [];
  for (const i of items) {
    if ("photos" in i) for (const p of i.photos) seconds.push(p.expires_in_seconds);
    else if (i.cover) seconds.push(i.cover.expires_in_seconds);
  }
  return seconds.length ? Math.min(...seconds) : null;
}

/** Rupees typed by the person ("38,500" or "38500.50") to paise, or null if it is not a plain amount of ₹1 to ₹10,00,000. */
export function rupeesToPaise(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const paise = Math.round(Number(t) * 100);
  return paise >= 100 && paise <= 100_000_000 ? paise : null;
}

/** The price bands as a customer is told them: money, so English in every language (the API's own wording). */
export const BAND_WORDS: Record<PriceBand, string> = {
  under_5k: "Under ₹5,000",
  "5k_10k": "₹5,000 to ₹10,000",
  "10k_25k": "₹10,000 to ₹25,000",
  "25k_50k": "₹25,000 to ₹50,000",
  above_50k: "Above ₹50,000",
};
