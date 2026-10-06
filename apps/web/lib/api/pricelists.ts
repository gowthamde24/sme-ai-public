import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the price-list CSV import of OUR API (rehearsal step 5).
 *
 * The file is parsed by the pinned parser behind the API; nothing here reads a price. What comes back about a file is numbers, the file's own sku and name cells (for the person to check) and
 * ISSUES: a row, a known column and a closed code, never a cell. A body that does not match the contract is an error, never rendered. Money is integer paise.
 */
/** A file is at most 900,000 BYTES of UTF-8 (not characters: an Indic character is three bytes). Next.js refuses a server-action request over 1 MB, so the form, the page and the API all stop below it. */
export const MAX_FILE_BYTES = 900_000;
export const FILE_TOO_BIG = "The file is too big: at most 900,000 bytes (about 900 KB).";
/** The size of a text in bytes, the way the API counts it. */
export function textBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export const PARSER_CODES = [
  "FILE_LIMIT", "INVALID_UTF8", "HEADER_REQUIRED", "DUPLICATE_COLUMN", "UNKNOWN_COLUMN", "MISSING_COLUMN", "UNPAIRED_BREAK_COLUMN", "CSV_FORMAT", "ROW_WIDTH", "INVALID_SKU", "DUPLICATE_SKU",
  "INVALID_NAME", "INVALID_MONEY", "MONEY_OUT_OF_RANGE", "INVALID_INTEGER", "INTEGER_OUT_OF_RANGE", "INCOMPLETE_BREAK", "BREAK_GAP", "INVALID_PRICE_BREAKS",
] as const; // fmt: skip
export const API_CODES = ["UNKNOWN_SKU", "HIDDEN_CHARACTERS", "NO_ITEMS", "TOO_MANY_ITEMS"] as const;
export const ISSUE_CODES = [...PARSER_CODES, ...API_CODES] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
export const COLUMNS = ["sku", "name", "unit_price", "moq", "tax_bps", "min_qty_1", "price_1", "min_qty_2", "price_2", "min_qty_3", "price_3", "min_qty_4", "price_4", "min_qty_5", "price_5"] as const;
export type Column = (typeof COLUMNS)[number];

/** What each closed code means, in plain words of OUR making. */
export const ISSUE_TEXT: Record<IssueCode, string> = {
  FILE_LIMIT: "The file is too big: at most 5,000 rows, 40 columns, and 200 characters in a cell (and 900,000 bytes in all).",
  INVALID_UTF8: "The file is not plain text that can be read.",
  HEADER_REQUIRED: "The first row must be the column names.",
  DUPLICATE_COLUMN: "A column name is used twice.",
  UNKNOWN_COLUMN: "A column is not one of the known ones.",
  MISSING_COLUMN: "A required column is missing.",
  UNPAIRED_BREAK_COLUMN: "A quantity column for a price break has no matching price column (or the reverse).",
  CSV_FORMAT: "The file is not valid CSV (check the quotes and commas).",
  ROW_WIDTH: "The row has a different number of cells than the header.",
  INVALID_SKU: "The sku may use only letters, digits, dot, underscore and hyphen (40 at most).",
  DUPLICATE_SKU: "This sku is already on an earlier row.",
  INVALID_NAME: "The name is empty or longer than 128 characters.",
  INVALID_MONEY: "This is not an amount in rupees (for example 4200 or 1,200.50).",
  MONEY_OUT_OF_RANGE: "The amount must be more than zero and at most ₹10,00,000.",
  INVALID_INTEGER: "This must be a whole number.",
  INTEGER_OUT_OF_RANGE: "This whole number is outside the allowed range.",
  INCOMPLETE_BREAK: "A price break needs both its quantity and its price.",
  BREAK_GAP: "Price breaks must start at break 1 and have no empty break before a filled one.",
  INVALID_PRICE_BREAKS: "Break quantities must go up, start at the minimum order quantity or above, and prices must not go up.",
  UNKNOWN_SKU: "This sku is not a product in your catalog (or it is archived or switched off).",
  HIDDEN_CHARACTERS: "The name has an invisible or control character. Retype it.",
  NO_ITEMS: "The file has no products.",
  TOO_MANY_ITEMS: "A price list holds at most 1,000 products.",
};
/** The column names a person knows. */
export const COLUMN_LABELS: Record<Column, string> = {
  sku: "sku", name: "name", unit_price: "unit price", moq: "minimum quantity", tax_bps: "GST rate",
  min_qty_1: "break 1 quantity", price_1: "break 1 price", min_qty_2: "break 2 quantity", price_2: "break 2 price", min_qty_3: "break 3 quantity", price_3: "break 3 price",
  min_qty_4: "break 4 quantity", price_4: "break 4 price", min_qty_5: "break 5 quantity", price_5: "break 5 price",
}; // fmt: skip

export interface Issue {
  row: number;
  column: Column | null;
  code: IssueCode;
}
export interface PriceBreak {
  min_qty: number;
  unit_price_paise: number;
}
export interface PreviewItem {
  sku: string;
  name: string;
  catalog_name: string | null;
  name_matches: boolean;
  sale_unit: "piece" | "set" | null;
  unit_price_paise: number;
  minimum_order_quantity: number;
  tax_bps: number;
  breaks: PriceBreak[];
}
export interface Preview {
  ok: boolean;
  parser_version: string;
  effective_from: string;
  row_count: number;
  canonical_hash: string | null;
  items: PreviewItem[];
  issues: Issue[];
}
export interface Committed {
  version_id: string;
  version_no: number;
  effective_from: string;
  item_count: number;
  content_sha256: string;
  replayed: boolean;
}

/** One line of a sentence for an issue: where, then what. A row of 0 is the file or its header. */
export function issueText(issue: Issue): string {
  const where = issue.row === 0 ? "The file" : `Row ${issue.row}${issue.column ? `, ${COLUMN_LABELS[issue.column]}` : ""}`;
  return `${where}: ${ISSUE_TEXT[issue.code]}`;
}

// ----------------------------------------------------------------------------- parsing
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a price list response.`);
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k));
const strOrNull = (r: Rec, k: string): string | null => (r[k] === null ? null : str(r, k));
const int = (r: Rec, k: string): number => (typeof r[k] === "number" && Number.isSafeInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : bad(k));
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(what));

function parseIssue(json: unknown): Issue {
  if (!isRecord(json)) return bad("issue");
  const column = json.column;
  if (column !== null && !(typeof column === "string" && (COLUMNS as readonly string[]).includes(column))) return bad("column");
  const code = json.code;
  if (typeof code !== "string" || !(ISSUE_CODES as readonly string[]).includes(code)) return bad("code");
  return { row: int(json, "row"), column: column as Column | null, code: code as IssueCode };
}

function parseItem(json: unknown): PreviewItem {
  if (!isRecord(json)) return bad("item");
  const unit = json.sale_unit;
  if (unit !== null && unit !== "piece" && unit !== "set") return bad("sale_unit");
  return {
    sku: str(json, "sku"),
    name: str(json, "name"),
    catalog_name: strOrNull(json, "catalog_name"),
    name_matches: bool(json, "name_matches"),
    sale_unit: unit,
    unit_price_paise: int(json, "unit_price_paise"),
    minimum_order_quantity: int(json, "minimum_order_quantity"),
    tax_bps: int(json, "tax_bps"),
    breaks: list(json.breaks, "breaks").map((b) => {
      if (!isRecord(b)) return bad("break");
      return { min_qty: int(b, "min_qty"), unit_price_paise: int(b, "unit_price_paise") };
    }),
  };
}

export function parsePreview(json: unknown): Preview {
  if (!isRecord(json)) return bad("preview");
  const hash = strOrNull(json, "canonical_hash");
  return {
    ok: bool(json, "ok"),
    parser_version: str(json, "parser_version"),
    effective_from: str(json, "effective_from"),
    row_count: int(json, "row_count"),
    canonical_hash: hash,
    items: list(json.items, "items").map(parseItem),
    issues: list(json.issues, "issues").map(parseIssue),
  };
}

export function parseCommitted(json: unknown): Committed {
  if (!isRecord(json)) return bad("version");
  return {
    version_id: str(json, "version_id"),
    version_no: int(json, "version_no"),
    effective_from: str(json, "effective_from"),
    item_count: int(json, "item_count"),
    content_sha256: str(json, "content_sha256"),
    replayed: bool(json, "replayed"),
  };
}

// ----------------------------------------------------------------------------- requests
function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** Check a file. Nothing is written. */
export async function previewPriceList(accessToken: string, tenantId: string, input: { csv: string; effectiveFrom: string }): Promise<Preview> {
  checked(tenantId);
  return parsePreview(await apiRequest(`/v1/tenants/${tenantId}/price-lists/import/preview`, accessToken, post({ csv: input.csv, effective_from: input.effectiveFrom })));
}

/** Make a price list version from a file (the API parses it again; a preview is never trusted). `id` is the version's id: a retry replays. */
export async function commitPriceList(accessToken: string, tenantId: string, input: { id: string; csv: string; effectiveFrom: string }): Promise<Committed> {
  checked(tenantId, input.id);
  return parseCommitted(await apiRequest(`/v1/tenants/${tenantId}/price-lists/import`, accessToken, post({ id: input.id, csv: input.csv, effective_from: input.effectiveFrom })));
}
