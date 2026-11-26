/**
 * A saree shop's list of what it sells, read from a sheet the owner already has (a CSV or TSV saved from Excel; a PDF or a photo goes through the API's reading and arrives in the same shape). Pure: no request, no React.
 * The owner's columns are never asked for by name: the header is read in English, Hindi, Telugu and Kannada words and in the shop's own shorthand ("rate", "MRP", "qty"); a sheet with no header is read as name then price.
 * Every row comes back with ONE plain status, so the preview can say what is wrong with it before anything is saved: nothing here saves.
 */
import { COLOURS, FABRICS, type Colour } from "@/lib/api/catalogue";

export const MAX_IMPORT_ROWS = 200;
const MAX_NAME = 120;

export type RowStatus = "ok" | "no_price" | "bad_price" | "no_name" | "duplicate" | "too_cheap";
export type ImportRow = {
  /** a stable key for the row in the preview (minted once, so a retry of a save is the same row) */
  id: string;
  name: string;
  /** what the owner wrote, kept as typed so they can correct it in place */
  priceText: string;
  /** whole rupees, null when there is none or it cannot be read */
  price: number | null;
  /** how many in stock, null = not said */
  count: number | null;
  colour: Colour | null;
  status: RowStatus;
  /** From a photo or a PDF only: how sure the reading was. A medium or low row says "Please check this one" until the owner edits it. */
  confidence?: "high" | "medium" | "low";
  /** a word of the reading about this row (colour, size...) */
  note?: string | null;
  /** the owner has looked at and changed it: the "check this one" flag goes */
  checked?: boolean;
  /** Into a list of his own: the other cells the reading matched (kept as read), and a price is optional there */
  cells?: Record<string, string | number | boolean | null>;
  optionalPrice?: boolean;
};
export type Parsed = { rows: ImportRow[]; cut: boolean; headerFound: boolean; error: "empty" | "no_rows" | null };

/** Splits CSV/TSV text into cells: quotes, doubled quotes, commas or tabs or semicolons (chosen from the first line), CRLF. */
export function cellsOf(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", "\t", ";", "|"].map((c) => ({ c, n: first.split(c).length })).sort((a, b) => b.n - a.n)[0];
  const delimiter = sep.n > 1 ? sep.c : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const WORDS = {
  name: ["name", "saree", "sari", "item", "product", "design", "description", "particulars", "title", "పేరు", "చీర", "నाम", "नाम", "साड़ी", "साडी", "ಹೆಸರು", "ಸೀರೆ"],
  price: ["price", "rate", "mrp", "amount", "cost", "rs", "inr", "₹", "ధర", "रेट", "कीमत", "दाम", "मूल्य", "ಬೆಲೆ", "ದರ"],
  count: ["stock", "qty", "quantity", "count", "pieces", "pcs", "nos", "available", "స్టాక్", "స్టాక్", "स्टॉक", "मात्रा", "ಸ್ಟಾಕ್"],
  colour: ["colour", "color", "రంగు", "रंग", "ಬಣ್ಣ"],
} as const;
type Field = keyof typeof WORDS;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}₹]+/gu, " ").trim();
function fieldOf(cell: string): Field | null {
  const c = norm(cell);
  if (c === "") return null;
  for (const f of Object.keys(WORDS) as Field[]) if (WORDS[f].some((w) => c === w || c.split(" ").includes(w))) return f;
  return null;
}

/** "₹24,500", "Rs. 6,200/-", "24500", "4,100.50", "INR 3500", "2.5k" to whole rupees; anything else (words, ranges, empty) is null. */
export function rupeesFrom(text: string): number | null {
  const s = text
    .toLowerCase()
    .replace(/₹|rs\.?|inr|rupees?|\/-|only/g, " ")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  const m = /^(\d+(?:\.\d{1,2})?)(k)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function colourIn(text: string): Colour | null {
  const t = norm(text);
  if (t === "") return null;
  const alias: Record<string, Colour> = { navy: "navy", "navy blue": "navy", golden: "gold", maroon: "maroon", multi: "multi", multicolour: "multi", multicolor: "multi", "many colours": "multi" };
  if (alias[t]) return alias[t];
  return (COLOURS as readonly string[]).find((c) => t === c) as Colour | undefined ?? null;
}

/** A fabric word inside the name, for the catalogue's own list ("Kanchi pattu bridal red" is kanchi_pattu); not asked of the owner. */
export function fabricIn(name: string): (typeof FABRICS)[number] {
  const t = norm(name).replace(/ /g, "");
  return (FABRICS.find((f) => f !== "other" && t.includes(f.replace(/_/g, ""))) ?? "other") as (typeof FABRICS)[number];
}

const MIN_RUPEES = 1;
let seq = 0;
const rowId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The status of one row against the rows before it (the same name twice is one product). */
export function statusOf(r: Pick<ImportRow, "name" | "priceText" | "price" | "optionalPrice">, seen: ReadonlySet<string>): RowStatus {
  if (r.name.trim() === "") return "no_name";
  if (seen.has(r.name.trim().toLowerCase())) return "duplicate";
  if (r.priceText.trim() === "") return r.optionalPrice ? "ok" : "no_price";
  if (r.price === null) return "bad_price";
  if (r.price < MIN_RUPEES) return "too_cheap";
  return "ok";
}

/** Recomputes every status after an edit or a removal. `added` = names already added from this list: a row with one of them stays "left out" (it would be the same saree twice). */
export function restatus(rows: readonly ImportRow[], added: ReadonlySet<string> = new Set()): ImportRow[] {
  const seen = new Set<string>(added);
  return rows.map((r) => {
    const price = rupeesFrom(r.priceText);
    const next = { ...r, price };
    const status = statusOf(next, seen);
    if (next.name.trim() !== "") seen.add(next.name.trim().toLowerCase());
    return { ...next, status };
  });
}

/** Rows from cells that are already split (a CSV, or a reading of a photo or PDF turned into cells). */
export function rowsFromCells(cells: string[][]): Parsed {
  if (cells.length === 0) return { rows: [], cut: false, headerFound: false, error: "empty" };
  const head = cells[0].map(fieldOf);
  const headerFound = head.includes("name") || head.includes("price");
  const col: Partial<Record<Field, number>> = {};
  if (headerFound) head.forEach((f, i) => f && col[f] === undefined && (col[f] = i));
  else {
    col.name = 0;
    col.price = 1;
  }
  const body = headerFound ? cells.slice(1) : cells;
  const raw: ImportRow[] = [];
  for (const line of body) {
    const name = (line[col.name ?? 0] ?? "").slice(0, MAX_NAME).trim();
    const priceText = (col.price !== undefined ? line[col.price] ?? "" : "").trim();
    if (name === "" && priceText === "") continue;
    const countText = col.count !== undefined ? (line[col.count] ?? "").trim() : "";
    const count = /^\d{1,6}$/.test(countText) ? Number(countText) : null;
    const colour = col.colour !== undefined ? colourIn(line[col.colour] ?? "") : null;
    raw.push({ id: rowId(), name, priceText, price: null, count, colour, status: "ok" });
  }
  if (raw.length === 0) return { rows: [], cut: false, headerFound, error: "no_rows" };
  const cut = raw.length > MAX_IMPORT_ROWS;
  return { rows: restatus(raw.slice(0, MAX_IMPORT_ROWS)), cut, headerFound, error: null };
}

/** Rows from the products reading of a photo or a PDF (every draft shown; the unsure ones carry their `confidence`). A draft with no price is `no_price` until the owner writes one. */
export function rowsFromDrafts(drafts: readonly { name: string; pricePaise: number | null; notes: string | null; confidence: "high" | "medium" | "low" }[]): Parsed {
  if (drafts.length === 0) return { rows: [], cut: false, headerFound: true, error: "no_rows" };
  const raw: ImportRow[] = drafts.slice(0, MAX_IMPORT_ROWS).map((d) => ({ id: rowId(), name: d.name.slice(0, MAX_NAME), priceText: d.pricePaise === null ? "" : String(Math.round(d.pricePaise / 100)), price: null, count: null, colour: null, status: "ok" as RowStatus, confidence: d.confidence, note: d.notes }));
  return { rows: restatus(raw), cut: drafts.length > MAX_IMPORT_ROWS, headerFound: true, error: null };
}

export const parseSheetText = (text: string): Parsed => rowsFromCells(cellsOf(text));

/** What the owner can still do with the rows: how many will be saved and how many need a look. */
export function counts(rows: readonly ImportRow[]): { ready: number; fix: number; skipped: number; check: number } {
  let ready = 0;
  let fix = 0;
  let skipped = 0;
  let check = 0;
  for (const r of rows) {
    if (r.status === "ok" && (r.confidence === "medium" || r.confidence === "low") && !r.checked) check++;
    if (r.status === "ok") ready++;
    else if (r.status === "duplicate") skipped++;
    else fix++;
  }
  return { ready, fix, skipped, check };
}
