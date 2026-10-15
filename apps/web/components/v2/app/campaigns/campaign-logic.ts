import type { Kind, RecipientRow } from "@/lib/api/campaigns";
import { rupeesToPaise } from "@/lib/money";

/**
 * The pure parts of the campaign screens (jobs CQ, CS): which kinds of reminder a business type may make (each needs its own module besides `campaigns`), the merge fields of a text, an example of how a text will read, the
 * steps in words, and reading a pasted or uploaded list of people into rows the API takes. Nothing here prices anything, sends anything or decides who may be reminded: the database checks every row and every message.
 */
export const KIND_MODULE: Record<Kind, string> = { payment_due: "dues", delivery_update: "deliveries", fee_due: "fees", event: "programmes", exam: "programmes", holiday: "programmes" };
export const MONEY_KINDS: readonly Kind[] = ["payment_due", "fee_due"];
export const isMoneyKind = (k: Kind): boolean => MONEY_KINDS.includes(k);

/** The kinds a business type with these modules may start (reminders only: no promotion is a kind). */
export function kindsFor(modules: readonly string[]): Kind[] {
  return (Object.keys(KIND_MODULE) as Kind[]).filter((k) => modules.includes(KIND_MODULE[k]));
}

export const FIELDS = ["name", "amount", "due_date", "reference", "business"] as const;
export type Field = (typeof FIELDS)[number];
/** The merge fields a kind may use: only a money reminder carries an amount. */
export const fieldsFor = (kind: Kind): readonly Field[] => (isMoneyKind(kind) ? FIELDS : FIELDS.filter((f) => f !== "amount"));

/** The fields a text uses, in order, once each; `bad` are `{{...}}` that are not a field (the database refuses them). */
export function fieldsUsed(text: string): { used: Field[]; bad: string[] } {
  const used: Field[] = [];
  const bad: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    const name = m[1];
    if ((FIELDS as readonly string[]).includes(name)) {
      if (!used.includes(name as Field)) used.push(name as Field);
    } else if (!bad.includes(name)) bad.push(name);
  }
  return { used, bad };
}

/** Put a field into the text at a position (the end if none), with a space on either side where one is missing. */
export function insertField(text: string, field: Field, at: number | null): { text: string; cursor: number } {
  const pos = at === null || at < 0 || at > text.length ? text.length : at;
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const token = `{{${field}}}`;
  const lead = before === "" || /\s$/.test(before) ? "" : " ";
  const tail = after === "" || /^[\s.,;:!?]/.test(after) ? "" : " ";
  return { text: `${before}${lead}${token}${tail}${after}`, cursor: (before + lead + token).length };
}

/** An example of how the text will read, with invented values: it only shows the shape (the real samples come from the list, with the database's own filling). */
export function exampleText(text: string, values: Record<Field, string>): string {
  return text.replace(/\{\{\s*(name|amount|due_date|reference|business)\s*\}\}/g, (_m, f: Field) => values[f]);
}

export type StepDraft = { offset: string; time: string };
export const MAX_STEPS = 5;
export type StepsResult = { ok: true; steps: { offset_days: number; time: string }[] } | { ok: false; reason: "none" | "offset" | "time" | "order" };

/** The steps as the form holds them, checked: a whole number of days from -60 to 180, a time as HH:MM, in order and each at its own moment. */
export function readSteps(drafts: readonly StepDraft[]): StepsResult {
  if (drafts.length < 1 || drafts.length > MAX_STEPS) return { ok: false, reason: "none" };
  const steps: { offset_days: number; time: string }[] = [];
  for (const d of drafts) {
    const raw = d.offset.trim().replace("−", "-");
    if (!/^-?\d{1,3}$/.test(raw)) return { ok: false, reason: "offset" };
    const n = Number(raw);
    if (n < -60 || n > 180) return { ok: false, reason: "offset" };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) return { ok: false, reason: "time" };
    steps.push({ offset_days: n, time: d.time });
  }
  const key = (s: { offset_days: number; time: string }) => s.offset_days * 10_000 + Number(s.time.replace(":", ""));
  for (let i = 1; i < steps.length; i++) if (key(steps[i]) <= key(steps[i - 1])) return { ok: false, reason: "order" };
  return { ok: true, steps };
}

export type StepWords = { before: (n: number) => string; on: () => string; after: (n: number) => string };
/** "3 days before", "on the day", "7 days after" in the person's language, through the words the caller hands in. */
export function stepPhrase(offset: number, w: StepWords): string {
  return offset < 0 ? w.before(-offset) : offset === 0 ? w.on() : w.after(offset);
}

// ---------------------------------------------------------------------------------------------------------------------------------------- the list
export type ParsedList = { rows: RecipientRow[]; errors: { line: number; reason: "columns" | "who" | "date" | "amount" | "reference" }[]; total: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[0-9+ ()-]{10,20}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$/;

function readDate(v: string): string | null {
  const t = v.trim();
  let y: string, m: string, d: string;
  let hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (hit) [, y, m, d] = hit;
  else if ((hit = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [, d, m, y] = hit;
  else return null;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso) ? iso : null;
}

/** Splits a line at commas or tabs (a spreadsheet pasted as text uses tabs); a field in double quotes may hold a comma. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === "," || ch === "\t") && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * A pasted or uploaded list: one person per line, `phone or contact id, date, amount in rupees (money reminders), reference (optional)`. A first line that is a heading is skipped. A line that cannot be read is
 * reported by its number and why, never guessed; the rest are kept. The phone number only FINDS an existing contact of the business: it is not stored.
 */
export function parseList(text: string, money: boolean): ParsedList {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, "")).filter((l) => l.trim() !== "");
  const rows: RecipientRow[] = [];
  const errors: ParsedList["errors"] = [];
  let first = true;
  lines.forEach((line, i) => {
    const cells = splitLine(line);
    const who = cells[0] ?? "";
    if (first) {
      first = false;
      if (!UUID.test(who) && !PHONE.test(who) && readDate(cells[1] ?? "") === null) return; // a heading
    }
    const row = i + 1;
    if (cells.length < 2) return void errors.push({ line: row, reason: "columns" });
    if (!UUID.test(who) && !PHONE.test(who)) return void errors.push({ line: row, reason: "who" });
    const due = readDate(cells[1]);
    if (due === null) return void errors.push({ line: row, reason: "date" });
    const out: RecipientRow = UUID.test(who) ? { contact_id: who.toLowerCase(), due_date: due } : { phone: who, due_date: due };
    const amount = (cells[2] ?? "").trim();
    if (money) {
      const paise = rupeesToPaise(amount, 100_000_000);
      if (paise === null || paise < 1) return void errors.push({ line: row, reason: "amount" });
      out.amount_paise = paise;
    } else if (amount !== "") return void errors.push({ line: row, reason: "amount" });
    const ref = (cells[3] ?? "").trim();
    if (ref !== "") {
      if (!REFERENCE.test(ref)) return void errors.push({ line: row, reason: "reference" });
      out.reference = ref;
    }
    rows.push(out);
  });
  return { rows, errors, total: rows.length + errors.length };
}
