import { ApiContractError, apiRequest, apiUploadRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The saree catalogue (job AY, ADR 0069), as the web needs it. Server side only, with the signed-in user's own token; the field names are the contract's, exactly (snake_case). A response that does not
 * match the contract is an error and nothing is shown.
 *
 * Who may do what (the API decides; the screens only hide what it would refuse): every member reads. Owner and Admin add, change, remove photos and reorder them, and see inactive items. The EXACT price
 * (`price_paise`) is set or cleared by the Owner alone, with the second factor; leave the field out of a save to keep it. An item is active only while it has a photo.
 *
 * Photos are reached by SIGNED URLs that expire (`expires_in_seconds`, 600): they are never stored, and the screens read the item again before they run out. The URLs are absolute and point at the storage
 * service; the page's Content-Security-Policy allows exactly that origin for images (lib/security/csp.ts).
 */
export const FABRICS = ["kanchi_pattu", "dharmavaram_silk", "soft_silk", "cotton_silk", "banarasi", "mysore_silk", "uppada", "pure_cotton", "georgette", "other"] as const;
export type Fabric = (typeof FABRICS)[number];
export const COLOURS = ["red", "maroon", "pink", "orange", "yellow", "green", "blue", "navy", "purple", "black", "white", "cream", "gold", "silver", "brown", "grey", "multi"] as const;
export type Colour = (typeof COLOURS)[number];
export const ZARIS = ["none", "light", "rich"] as const;
export type Zari = (typeof ZARIS)[number];
export const OCCASIONS = ["wedding", "festival", "daily", "party"] as const;
export type Occasion = (typeof OCCASIONS)[number];
export const PRICE_BANDS = ["under_5k", "5k_10k", "10k_25k", "25k_50k", "above_50k"] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];
export const STOCK_STATUSES = ["in_stock", "few_left", "made_to_order"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** The limits of the contract the screens keep to. */
export const MAX_PHOTOS = 8;
export const MAX_COLOURS = 4;
export const MAX_OCCASIONS = 4;
export const MAX_NAME = 120;
export const MAX_BORDER = 120;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** The least and most the exact price may be, in paise (₹1 to ₹10,00,000). */
export const MIN_PRICE_PAISE = 100;
export const MAX_PRICE_PAISE = 100_000_000;

export interface Photo {
  id: string;
  /** 1 = the cover. */
  position: number;
  url: string | null;
  thumb_url: string | null;
  width: number;
  height: number;
  bytes: number;
  expires_in_seconds: number;
}

export interface ItemBase {
  id: string;
  name: string;
  fabric: Fabric;
  fabric_label: string;
  colours: Colour[];
  zari: Zari;
  border: string | null;
  occasions: Occasion[];
  price_band: PriceBand;
  price_band_label: string;
  /** The exact price in paise, only when the Owner set one. */
  price_paise: number | null;
  price_text: string | null;
  stock_status: StockStatus;
  stock_label: string;
  active: boolean;
  photo_count: number;
  created_at: string;
  updated_at: string;
}
export interface ItemSummary extends ItemBase {
  cover: Photo | null;
}
export interface Item extends ItemBase {
  photos: Photo[];
}
export interface ItemPage {
  items: ItemSummary[];
  next_cursor: string | null;
}

/** The whole item for a save. `price` is absent to keep the exact price, `{ paise }` to set it and `{ clear: true }` to clear it (Owner with the second factor only). */
export interface ItemInput {
  name: string;
  fabric: Fabric;
  colours: Colour[];
  zari: Zari;
  border: string | null;
  occasions: Occasion[];
  priceBand: PriceBand;
  stockStatus: StockStatus;
  active: boolean;
  price?: { paise: number } | { clear: true };
}

export interface ItemFilters {
  fabric?: Fabric;
  colours?: readonly Colour[];
  occasions?: readonly Occasion[];
  priceBands?: readonly PriceBand[];
  inStock?: boolean;
  includeInactive?: boolean;
  after?: string | null;
  limit?: number;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a catalogue response.`);
}
const oneOf = <T extends string>(list: readonly T[], v: unknown, what: string): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : bad(what));
const uuid = (v: unknown, what: string): string => (typeof v === "string" && isCanonicalUuid(v) ? v : bad(what));
const str = (v: unknown, what: string, max: number): string => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : bad(what));
const nullableStr = (v: unknown, what: string, max: number): string | null => (v === null ? null : typeof v === "string" && v.length <= max ? v : bad(what));
const bool = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const int = (v: unknown, what: string, min: number, max: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : bad(what));
function when(v: unknown, what: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what);
}
/** A link to a picture: http or https only, of a sane length. Anything else is a contract error, never put in an <img>. */
export function pictureUrl(v: unknown, what: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > 2048) return bad(what);
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : bad(what);
  } catch {
    return bad(what);
  }
}
const list = <T extends string>(v: unknown, all: readonly T[], what: string, max: number): T[] => (Array.isArray(v) && v.length <= max ? v.map((x) => oneOf(all, x, what)) : bad(what));

export function parsePhoto(json: unknown): Photo {
  if (!isRecord(json)) return bad("photo");
  return {
    id: uuid(json.id, "photo id"),
    position: int(json.position, "position", 1, MAX_PHOTOS),
    url: pictureUrl(json.url, "photo url"),
    thumb_url: pictureUrl(json.thumb_url, "thumb url"),
    width: int(json.width, "width", 1, 20000),
    height: int(json.height, "height", 1, 20000),
    bytes: int(json.bytes, "bytes", 1, 20 * 1024 * 1024),
    expires_in_seconds: int(json.expires_in_seconds, "expires_in_seconds", 1, 86_400),
  };
}

function parseBase(json: Rec): ItemBase {
  const price = json.price_paise;
  return {
    id: uuid(json.id, "id"),
    name: str(json.name, "name", MAX_NAME),
    fabric: oneOf(FABRICS, json.fabric, "fabric"),
    fabric_label: str(json.fabric_label, "fabric_label", 60),
    colours: list(json.colours, COLOURS, "colour", MAX_COLOURS),
    zari: oneOf(ZARIS, json.zari, "zari"),
    border: nullableStr(json.border, "border", MAX_BORDER),
    occasions: list(json.occasions, OCCASIONS, "occasion", MAX_OCCASIONS),
    price_band: oneOf(PRICE_BANDS, json.price_band, "price_band"),
    price_band_label: str(json.price_band_label, "price_band_label", 60),
    price_paise: price === null ? null : int(price, "price_paise", MIN_PRICE_PAISE, MAX_PRICE_PAISE),
    price_text: nullableStr(json.price_text, "price_text", 40),
    stock_status: oneOf(STOCK_STATUSES, json.stock_status, "stock_status"),
    stock_label: str(json.stock_label, "stock_label", 40),
    active: bool(json.active, "active"),
    photo_count: int(json.photo_count, "photo_count", 0, MAX_PHOTOS),
    created_at: when(json.created_at, "created_at"),
    updated_at: when(json.updated_at, "updated_at"),
  };
}

export function parseItemSummary(json: unknown): ItemSummary {
  if (!isRecord(json)) return bad("item");
  return { ...parseBase(json), cover: json.cover === null || json.cover === undefined ? null : parsePhoto(json.cover) };
}

export function parseItem(json: unknown): Item {
  if (!isRecord(json) || !Array.isArray(json.photos) || json.photos.length > MAX_PHOTOS) return bad("item");
  return { ...parseBase(json), photos: json.photos.map(parsePhoto) };
}

export function parseItemPage(json: unknown): ItemPage {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 50) return bad("page");
  const cursor = json.next_cursor;
  if (cursor !== null && (typeof cursor !== "string" || cursor === "" || cursor.length > 400)) return bad("next_cursor");
  return { items: json.items.map(parseItemSummary), next_cursor: cursor };
}

export function parseSave(json: unknown): { item: Item; created: boolean } {
  if (!isRecord(json)) return bad("save result");
  return { item: parseItem(json.item), created: json.created === true };
}

export function parsePhotoResult(json: unknown): { photo: Photo; replayed: boolean; item: Item } {
  if (!isRecord(json)) return bad("photo result");
  return { photo: parsePhoto(json.photo), replayed: json.replayed === true, item: parseItem(json.item) };
}

const tenantPath = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/catalogue/${tail}`;
};
const idOf = (id: string) => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};

/** `GET /catalogue/items`: the catalogue in the API's fixed order (in stock, few left, made to order, then by name). `limit` 1 to 50. `includeInactive` is honoured for the Owner and Admin only. */
export async function listCatalogueItems(accessToken: string, tenantId: string, f: ItemFilters = {}): Promise<ItemPage> {
  const q = new URLSearchParams({ limit: String(f.limit ?? 24) });
  if (f.fabric) q.set("fabric", f.fabric);
  if (f.colours?.length) q.set("colour", f.colours.join(","));
  if (f.occasions?.length) q.set("occasion", f.occasions.join(","));
  if (f.priceBands?.length) q.set("price_band", f.priceBands.join(","));
  if (f.inStock) q.set("in_stock", "true");
  if (f.includeInactive) q.set("include_inactive", "true");
  if (f.after) q.set("after", f.after);
  return parseItemPage(await apiRequest(tenantPath(tenantId, `items?${q.toString()}`), accessToken));
}

/** `GET /catalogue/items/{id}`: the item with all its photos (fresh signed URLs). */
export async function getCatalogueItem(accessToken: string, tenantId: string, id: string): Promise<Item> {
  return parseItem(await apiRequest(tenantPath(tenantId, `items/${idOf(id)}`), accessToken));
}

/** `PUT /catalogue/items/{id}`: create or change, the whole item at once; the same id again is a retry. Owner and Admin; the exact price the Owner alone, with the second factor. */
export async function putCatalogueItem(accessToken: string, tenantId: string, id: string, input: ItemInput): Promise<{ item: Item; created: boolean }> {
  const body: Record<string, unknown> = {
    name: input.name,
    fabric: input.fabric,
    colours: input.colours,
    zari: input.zari,
    border: input.border,
    occasions: input.occasions,
    price_band: input.priceBand,
    stock_status: input.stockStatus,
    active: input.active,
  };
  if (input.price) body.price_paise = "clear" in input.price ? null : input.price.paise;
  return parseSave(await apiRequest(tenantPath(tenantId, `items/${idOf(id)}`), accessToken, { method: "PUT", body: JSON.stringify(body) }));
}

/** `POST /catalogue/items/{id}/photos?photo_id=`: the photo is the raw body with its own type. The same `photoId` is a retry and replays. Owner and Admin. */
export async function uploadCataloguePhoto(accessToken: string, tenantId: string, itemId: string, photoId: string, body: ArrayBuffer | Blob, contentType: string) {
  if (!(PHOTO_TYPES as readonly string[]).includes(contentType)) throw new ApiContractError("type");
  return parsePhotoResult(await apiUploadRequest(tenantPath(tenantId, `items/${idOf(itemId)}/photos?photo_id=${idOf(photoId)}`), accessToken, body, contentType));
}

/** `POST /catalogue/photos/{id}/remove`: take a photo off; the last photo of an active item cannot go (409 `needs_photo`). Owner and Admin. */
export async function removeCataloguePhoto(accessToken: string, tenantId: string, photoId: string): Promise<Item> {
  return parseItem(await apiRequest(tenantPath(tenantId, `photos/${idOf(photoId)}/remove`), accessToken, { method: "POST" }));
}

/** `PUT /catalogue/items/{id}/photos/order`: every live photo once, in the new order; the first is the cover. Owner and Admin. */
export async function reorderCataloguePhotos(accessToken: string, tenantId: string, itemId: string, photoIds: readonly string[]): Promise<Item> {
  return parseItem(await apiRequest(tenantPath(tenantId, `items/${idOf(itemId)}/photos/order`), accessToken, { method: "PUT", body: JSON.stringify({ photo_ids: photoIds.map(idOf) }) }));
}
