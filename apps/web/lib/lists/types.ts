/**
 * "What you sell" as named lists (owner's idea, 29 Nov 2026; C1's contract docs/contracts/sell-lists.md). A list has a name, a kind, columns the owner shapes and items (rows). The words on screen come from the string
 * store; the codes below are the API's closed words.
 */
export const LIST_KINDS = ["products", "digital", "services", "bookings", "courses", "subscriptions", "rentals", "food", "events", "other"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const COLUMN_TYPES = ["text", "number", "rupees", "yes_no", "choice", "photo", "link", "date", "datetime", "duration"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const COLUMN_ROLES = ["price", "availability", "quantity", "how_to_buy", "description"] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];
export const BILLING_PERIODS = ["one_time", "per_month", "per_year", "per_hour", "per_day", "per_unit", "from"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const MAX_COLUMNS = 12;
export const MAX_LISTS = 10;
export const NAME_MAX = 60;
export const LABEL_MAX = 40;
export const ROW_NAME_MAX = 120;

export type Column = {
  /** The stable slug the API made once; absent on a column that is not saved yet. */
  readonly key: string | null;
  readonly label: string;
  readonly type: ColumnType;
  readonly choices: readonly string[];
  readonly role: ColumnRole | null;
  readonly billingPeriod: BillingPeriod | null;
  readonly quoteDefault: boolean;
};
export type SellList = { readonly id: string; readonly name: string; readonly kind: ListKind; readonly isMain: boolean; readonly rowCount: number; readonly columns: readonly Column[] };
/** A cell is what its column holds: text, a number (rupees in whole paise), yes or no, or nothing. */
export type Cell = string | number | boolean | null;
export type Row = { readonly id: string; readonly name: string; readonly cells: Readonly<Record<string, Cell>>; readonly active: boolean };
export type RowPage = { readonly items: readonly Row[]; readonly nextCursor: string | null };

/** The closed refusals of the routes, drawn as plain sentences by the screen (never the API's own text). */
export const REFUSALS = ["list_limit", "column_limit", "row_limit", "name_taken", "one_default_price", "role_taken", "column_has_data", "value_not_allowed", "not_a_price", "validation_error", "forbidden", "step_up_required", "not_found", "unavailable"] as const;
export type Refusal = (typeof REFUSALS)[number];
export type Fail = { readonly ok: false; readonly error: Refusal; readonly fields?: readonly string[] };
export type Done<T> = { readonly ok: true; readonly data: T } | Fail;

export const isKind = (v: unknown): v is ListKind => typeof v === "string" && (LIST_KINDS as readonly string[]).includes(v);

/** The price columns of a list, in order; the one to quote by default is the first flagged, else the first. */
export const priceColumns = (list: Pick<SellList, "columns">): Column[] => list.columns.filter((c) => c.role === "price");

/** A rupee cell is whole paise: "₹1,450" for 145000. */
export function rupees(paise: number): string {
  const r = Math.floor(paise / 100);
  const s = String(r);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `₹${rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},` : ""}${last3}${paise % 100 ? `.${String(paise % 100).padStart(2, "0")}` : ""}`;
}
/** What the person types ("1450", "1,450", "₹1,450.50") as whole paise, or null when it is not an amount of at least ₹1. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[₹,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const paise = Math.round(Number(t) * 100);
  return paise >= 100 ? paise : null;
}
