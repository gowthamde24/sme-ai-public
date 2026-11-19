import type { Colour, Fabric, Occasion, PriceBand, Zari } from "@/lib/api/catalogue";

/**
 * WHAT YOU SELL (JOBS, owner 19 Nov; mock r3-04): one section per business, in one of five styles chosen by the business type's pack. The domain types the screens draw, one entry per style; the wire shapes they are read from are in
 * `lib/api/what-you-sell.ts` (the ONE adapter). Money is integer paise everywhere; the API sends CODES (closed words) and numbers, the words live in `jobs.sell.*`.
 */
export const SELL_STYLES = ["products", "services", "courses", "properties", "pricelist"] as const;
export type SellStyle = (typeof SELL_STYLES)[number];

/** How many are left of a product: the catalogue's three stock words plus "sold out" (a count of 0). */
export const STOCK_STATES = ["in_stock", "few_left", "made_to_order", "sold_out"] as const;
export type StockState = (typeof STOCK_STATES)[number];
/** When a service can be booked. */
export const BOOKING_WORDS = ["any_day", "not_sunday", "book_ahead"] as const;
export type Booking = (typeof BOOKING_WORDS)[number];
/** Where a service is done (More choices). */
export const PLACE_WORDS = ["at_shop", "at_home", "both"] as const;
export type Place = (typeof PLACE_WORDS)[number];
export const PROPERTY_STATUSES = ["available", "booked", "sold"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const SIZE_UNITS = ["sq_ft", "sq_yd", "acre", "cent"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];
/** What a wholesale item is counted in. */
export const QTY_UNITS = ["piece", "metre", "kg", "set", "dozen"] as const;
export type QtyUnit = (typeof QTY_UNITS)[number];
/** The seats of a batch: how many are left, or full. */
export const SEAT_STATES = ["open", "left", "full"] as const;
export type SeatState = (typeof SEAT_STATES)[number];

export type ProductEntry = {
  style: "products";
  id: string;
  name: string;
  /** The cover photo (a signed link that runs out), or null. */
  photo: string | null;
  /** The exact price, only when the Owner set one. */
  pricePaise: number | null;
  /** The catalogue's price band, always there (the API keeps it for everyone). */
  priceBand: PriceBand;
  /** The variants: the colours (the catalogue's closed list). */
  colours: Colour[];
  stock: { state: StockState; count: number | null };
  /** What the catalogue keeps and the sheet does not ask: a save sends the WHOLE item, so these are carried as they are (the same payload the old form sends). */
  keep: { fabric: Fabric; zari: Zari; border: string | null; occasions: Occasion[]; active: boolean };
};
export type ServiceEntry = { style: "services"; id: string; name: string; minutes: number; pricePaise: number; priceFrom: boolean; booking: Booking; place: Place | null };
export type CourseEntry = { style: "courses"; id: string; name: string; batch: string; startsOn: string | null; feePaise: number | null; seats: { state: SeatState; count: number | null }; total: number | null };
export type PropertyEntry = { style: "properties"; id: string; name: string; location: string; size: number; sizeUnit: SizeUnit; note: string | null; pricePaise: number; status: PropertyStatus };
export type PriceRate = { fromQty: number; ratePaise: number };
export type PriceEntry = { style: "pricelist"; id: string; name: string; moq: number; unit: QtyUnit; rates: PriceRate[]; goodUntil: string | null };

export type SellEntry = ProductEntry | ServiceEntry | CourseEntry | PropertyEntry | PriceEntry;
export type EntryOf<S extends SellStyle> = Extract<SellEntry, { style: S }>;

/** What the section reads: the style, its entries, and whether they are the shop's real ones (`live`) or the test mode's made-up ones. */
export type SellData = { style: SellStyle; entries: SellEntry[]; live: boolean };

/** The sheet's choices for one entry (strings as typed; the server action checks and turns them into the payload). */
export type ProductForm = { name: string; price: string; colours: Colour[]; stock: "in_stock" | "few_left" | "made_to_order"; count: string };
export type ServiceForm = { name: string; minutes: string; price: string; priceFrom: boolean; booking: Booking; place: Place | "" };
export type CourseForm = { name: string; batch: string; startsOn: string; fee: string; seats: string };
export type PropertyForm = { name: string; location: string; size: string; sizeUnit: SizeUnit; price: string; status: PropertyStatus; note: string };
export type PriceForm = { name: string; moq: string; unit: QtyUnit; rates: { fromQty: string; rate: string }[]; goodUntil: string };
export type SellForm = { products: ProductForm; services: ServiceForm; courses: CourseForm; properties: PropertyForm; pricelist: PriceForm };
