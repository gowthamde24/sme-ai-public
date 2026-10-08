import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The item types of a workspace (the owner's own list: what a typed-price quote line is about) and their OPTIONAL price range, read from `GET /v1/tenants/{tenant}/item-types`
 * (Owner, Admin and Sales may read it). Server side only, with the signed-in user's own token. A response that does not match is a contract error and nothing is shown.
 *
 * Money is integer paise. The range is information for the person typing a price, never a rule of the screen: the screen shows a neutral note and goes on.
 */
export const PRICE_LIMITS = { minPaise: 1, maxPaise: 100_000_000 } as const;

export interface ItemType {
  id: string;
  code: string;
  name: string;
  position: number;
  active: boolean;
  min_price_paise: number | null;
  max_price_paise: number | null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an item type response.`);
}
const CODE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$/;

function price(r: Rec, key: string): number | null {
  const v = r[key];
  if (v === null) return null;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= PRICE_LIMITS.minPaise && v <= PRICE_LIMITS.maxPaise ? v : bad(key);
}

export function parseItemType(json: unknown): ItemType {
  if (!isRecord(json)) return bad("item type");
  const { id, code, name, position, active } = json;
  if (typeof id !== "string" || !isCanonicalUuid(id)) return bad("id");
  if (typeof code !== "string" || !CODE.test(code)) return bad("code");
  if (typeof name !== "string" || name.trim() === "" || name.length > 200) return bad("name");
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0 || position > 10_000) return bad("position");
  if (typeof active !== "boolean") return bad("active");
  const low = price(json, "min_price_paise");
  const high = price(json, "max_price_paise");
  if (low !== null && high !== null && low > high) return bad("price range");
  return { id, code, name, position, active, min_price_paise: low, max_price_paise: high };
}

export function parseItemTypes(json: unknown): ItemType[] {
  if (!Array.isArray(json)) return bad("item types");
  return json.map(parseItemType);
}

/** The item types a NEW quote line may use: the active ones, in the owner's display order (then by code). */
export function sellableItemTypes(types: ItemType[]): ItemType[] {
  return types.filter((t) => t.active).sort((a, b) => a.position - b.position || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * True when a typed price (integer paise) lies below the item type's lowest or above its highest. A bound that is missing is no bound; no bounds at all never warn.
 * The same rule as `price_outside_range` in services/ai-api/app/quotes/price_range.py (and the database's `app.price_outside_range`): the API and the database decide;
 * this is only for the neutral note. A price that is not a whole number of paise of at least 1 is not a price at all (an error, not "inside").
 */
export function priceOutsideRange(pricePaise: number, min: number | null, max: number | null): boolean {
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 1) throw new ApiContractError("A price must be a whole number of paise, at least 1.");
  return (min !== null && pricePaise < min) || (max !== null && pricePaise > max);
}

export async function fetchItemTypes(accessToken: string, tenantId: string): Promise<ItemType[]> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseItemTypes(await apiRequest(`/v1/tenants/${tenantId}/item-types`, accessToken));
}

export interface SaveItemTypeInput {
  code: string;
  name: string;
  position: number;
  active: boolean;
  /** Integer paise, or null for "no lowest price". */
  minPricePaise: number | null;
  /** Integer paise, or null for "no highest price". */
  maxPricePaise: number | null;
}
export interface SavedItemType {
  id: string;
  code: string;
  /** false: the code already existed and its record was REPLACED (the API has no create-only call). */
  created: boolean;
}

export function parseSavedItemType(json: unknown): SavedItemType {
  if (!isRecord(json)) return bad("save result");
  const { id, code, created } = json;
  if (typeof id !== "string" || !isCanonicalUuid(id)) return bad("id");
  if (typeof code !== "string" || !CODE.test(code)) return bad("code");
  if (typeof created !== "boolean") return bad("created");
  return { id, code, created };
}

/**
 * Create or REPLACE one item type (`PUT /v1/tenants/{tenant}/item-types/{code}`; Owner or Admin with a second factor). The body has exactly the keys the API allows and a price bound that is
 * not set goes as null: the call replaces the whole record. The code is in the path, is never changed afterwards and the API has no delete.
 */
export async function saveItemType(accessToken: string, tenantId: string, input: SaveItemTypeInput): Promise<SavedItemType> {
  if (!isCanonicalUuid(tenantId) || !CODE.test(input.code)) throw new ApiContractError("id");
  const body = { name: input.name, position: input.position, active: input.active, min_price_paise: input.minPricePaise, max_price_paise: input.maxPricePaise };
  return parseSavedItemType(await apiRequest(`/v1/tenants/${tenantId}/item-types/${input.code}`, accessToken, { method: "PUT", body: JSON.stringify(body) }));
}

