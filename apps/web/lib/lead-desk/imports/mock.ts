import { DEFAULT_TAG, FIELD_KEYS, MAX_ROWS, mappingHasContact, type Column, type Confidence, type Counts, type Failure, type Field, type FieldInfo, type Mapping, type PreviewBody, type PreviewResult, type Problem, type ReadBody, type ReadResult, type RefusedReason } from "./types";

/**
 * TEST MODE of the import (LEADS_SCREENS=mock): the read and the preview are worked out HERE from the pasted text or the CSV text, so the whole screen can be tried without the API. A real Indian mobile check
 * (10 digits starting 6 to 9, +91 allowed), duplicates inside the list, invalid counting. An Excel file (.xlsx) cannot be read in test mode ("csv_only"). The Do-Not-Disturb list is faked: a number ending in 99 is on it.
 * Nothing is sent anywhere. SERVER ONLY (it decodes base64 with Buffer). Pure: the clock and the cookie are not touched here.
 */
export const SAMPLE_SHEET = ["Name,Mobile,City,Message", "Asha,90000 00001,Hyderabad,Looking for a 2 BHK", "Bala,+91 90000-00002,Vijayawada,Wants a site visit", "Chitra,90000 00003,Guntur,Asked about prices", "Asha again,9000000001,Hyderabad,Called twice", "Dev,12345,Nellore,Number is wrong", "Esha,90000 00099,Tirupati,Wants a call back"].join("\n");

export function normalizeIndianMobile(raw: string): string | null {
  let d = raw.trim().replace(/\.0+$/, "").replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) {
    if (!d.startsWith("+91")) return null;
    d = d.slice(3);
  } else if (d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;
export const isEmail = (s: string): boolean => EMAIL.test(s.trim());
/** Test mode's Do-Not-Disturb list. */
export const onFakeDnd = (e164: string): boolean => e164.endsWith("99");

type Refused = Failure;
const refuse = (reason: RefusedReason): Refused => ({ ok: false, error: "sheet_refused", reason });

/** A small CSV reader: quotes, doubled quotes, comma / semicolon / tab (the one used most on the first line). */
export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length - 1;
  const delim = count("\t") > 0 && count("\t") >= count(",") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw new Error("malformed");
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

type RawLead = { row: number; name: string; phone: string; email: string };
type Parsed = { table: { headers: string[]; rows: string[][] } } | { leads: RawLead[] };

function decodeBase64(b64: string): { text: string } | { error: Refused } {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return { error: refuse("empty") };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { error: { ok: false, error: "csv_only" } };
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return { error: { ok: false, error: "csv_only" } };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "") };
  } catch {
    return { error: refuse("not_utf8") };
  }
}

function pasteLeads(text: string): RawLead[] {
  const out: RawLead[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    const parts = (line.includes("\t") ? line.split("\t") : line.split(",")).map((p) => p.trim()).filter((p) => p !== "");
    const phoneAt = parts.findIndex((p) => normalizeIndianMobile(p) !== null);
    const emailAt = parts.findIndex((p) => isEmail(p));
    const phone = phoneAt >= 0 ? parts[phoneAt] : (parts.find((p) => /\d{5,}/.test(p)) ?? "");
    const email = emailAt >= 0 ? parts[emailAt] : "";
    const name = parts.find((p, j) => j !== phoneAt && j !== emailAt && !/^[\d+\s().-]{5,}$/.test(p)) ?? "";
    out.push({ row: i + 1, name, phone, email });
  });
  return out;
}

function vcardLeads(text: string): RawLead[] {
  const out: RawLead[] = [];
  let n = 0;
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    n += 1;
    const get = (prop: string): string => {
      const m = new RegExp(`^${prop}[^:\\n]*:(.*)$`, "im").exec(card);
      return m ? m[1].trim() : "";
    };
    out.push({ row: n, name: get("FN") || get("N").replace(/;+/g, " ").trim(), phone: get("TEL"), email: get("EMAIL") });
  }
  return out;
}

function parseBody(body: ReadBody): { ok: true; parsed: Parsed } | Refused {
  if (body.kind === "paste") return { ok: true, parsed: { leads: pasteLeads(body.text ?? "") } };
  if (body.kind === "vcard") {
    let text = body.text ?? "";
    if (!text.trim() && body.content_base64) {
      const d = decodeBase64(body.content_base64);
      if ("error" in d) return d.error;
      text = d.text;
    }
    return { ok: true, parsed: { leads: vcardLeads(text) } };
  }
  let text: string;
  if (body.kind === "sheet") {
    const u = body.sheet_url ?? "";
    if (/private/i.test(u)) return { ok: false, error: "sheet_not_public" };
    text = SAMPLE_SHEET;
  } else {
    if (/\.(xlsx|xlsm|xls)$/i.test(body.filename ?? "")) return { ok: false, error: "csv_only" };
    const d = decodeBase64(body.content_base64 ?? "");
    if ("error" in d) return d.error;
    text = d.text;
  }
  let rows: string[][];
  try {
    rows = splitCsv(text);
  } catch {
    return refuse("malformed_csv");
  }
  if (rows.length === 0) return refuse("empty");
  const headers = rows[0];
  if (headers.every((h) => h === "")) return refuse("no_header");
  if (headers.length > 60) return refuse("too_many_columns");
  if (rows.length - 1 > MAX_ROWS) return refuse("too_many_rows");
  return { ok: true, parsed: { table: { headers, rows: rows.slice(1).map((r) => headers.map((_, i) => r[i] ?? "")) } } };
}

const KEYWORDS: Record<Field, { exact: string[]; part: string[] }> = {
  name: { exact: ["name", "full name", "fullname", "lead name", "customer name", "naam", "పేరు", "नाम", "ಹೆಸರು"], part: ["name", "naam", "పేరు", "नाम", "ಹೆಸರು"] },
  phone: { exact: ["phone", "mobile", "mobile number", "phone number", "mob", "mob no", "mob. no.", "whatsapp", "wa number", "whatsapp number", "contact number", "contact no", "number", "ఫోన్", "మొబైల్", "फोन", "मोबाइल", "ಫೋನ್", "ಮೊಬೈಲ್"], part: ["phone", "mobile", "whatsapp", "mob", "contact no", "ఫోన్", "మొబైల్", "फोन", "मोबाइल", "ಫೋನ್", "ಮೊಬೈಲ್"] },
  email: { exact: ["email", "e-mail", "email id", "mail", "ఈమెయిల్", "ईमेल", "ಇಮೇಲ್"], part: ["email", "e-mail", "mail", "ఈమెయిల్", "ईमेल", "ಇಮೇಲ್"] },
  city: { exact: ["city", "town", "location", "place", "నగరం", "शहर", "ನಗರ"], part: ["city", "town", "location", "నగరం", "शहर", "ನಗರ"] },
  message: { exact: ["message", "requirement", "enquiry", "inquiry", "query", "comments", "remarks", "details"], part: ["message", "requirement", "enquiry", "inquiry", "query", "comment", "remark"] },
  external_id: { exact: ["id", "lead id", "external id", "reference", "ref", "enquiry id", "query id"], part: ["lead id", "external id", "enquiry id", "query id", "reference"] },
  received_at: { exact: ["date", "time", "timestamp", "created", "created at", "received", "received at", "date time"], part: ["date", "timestamp", "created", "received"] },
  source_note: { exact: ["source", "note", "notes", "campaign", "source note"], part: ["source", "note", "campaign"] },
};
const norm = (h: string): string => h.toLowerCase().replace(/\s+/g, " ").trim();

/** The suggestion: the headers first (exact, then partial), then the shape of the values for a phone or an e-mail. Each field goes to one column. */
export function suggestColumns(headers: string[], rows: string[][]): { columns: Column[]; mapping: Mapping } {
  const picks: Array<{ field: Field | null; confidence: Confidence }> = headers.map(() => ({ field: null, confidence: "none" }));
  const taken = new Set<Field>();
  const assign = (level: "exact" | "partial") => {
    headers.forEach((h, i) => {
      if (picks[i].field) return;
      const n = norm(h);
      for (const f of FIELD_KEYS) {
        if (taken.has(f)) continue;
        const k = KEYWORDS[f];
        if (level === "exact" ? k.exact.includes(n) : k.part.some((p) => p.length >= 3 && n.includes(p))) {
          picks[i] = { field: f, confidence: level };
          taken.add(f);
          return;
        }
      }
    });
  };
  assign("exact");
  assign("partial");
  headers.forEach((_, i) => {
    if (picks[i].field) return;
    const values = rows.map((r) => r[i] ?? "").filter((v) => v !== "").slice(0, 20);
    if (values.length === 0) return;
    if (!taken.has("phone") && values.every((v) => normalizeIndianMobile(v) !== null)) {
      picks[i] = { field: "phone", confidence: "weak" };
      taken.add("phone");
    } else if (!taken.has("email") && values.every(isEmail)) {
      picks[i] = { field: "email", confidence: "weak" };
      taken.add("email");
    }
  });
  const mapping: Mapping = {};
  picks.forEach((p, i) => {
    if (p.field) mapping[p.field] = i;
  });
  return { columns: headers.map((h, i) => ({ index: i, header: h.slice(0, 120), samples: rows.slice(0, 3).map((r) => (r[i] ?? "").slice(0, 80)), field: picks[i].field, confidence: picks[i].confidence })), mapping };
}

const FIELD_INFO: FieldInfo[] = FIELD_KEYS.map((field) => ({ field, label: field, required: false }));

export type ReadOutcome = { ok: true; read: ReadResult } | Refused;

export function mockRead(body: ReadBody): ReadOutcome {
  const got = parseBody(body);
  if (!got.ok) return got;
  const p = got.parsed;
  if ("leads" in p) {
    if (p.leads.length === 0) return refuse("empty");
    if (p.leads.length > MAX_ROWS) return refuse("too_many_rows");
    return { ok: true, read: { kind: body.kind, rows: p.leads.length, columns: [], fields: FIELD_INFO, mapping: null, mapped_by: "none", needs_confirmation: false, warnings: [] } };
  }
  const s = suggestColumns(p.table.headers, p.table.rows);
  return { ok: true, read: { kind: body.kind, rows: p.table.rows.length, columns: s.columns, fields: FIELD_INFO, mapping: s.mapping, mapped_by: "rules", needs_confirmation: true, warnings: [] } };
}

function leadsOf(p: Parsed, mapping: Mapping | null): RawLead[] | "mapping" {
  if ("leads" in p) return p.leads;
  if (!mappingHasContact(mapping)) return "mapping";
  const cell = (r: string[], f: Field): string => (mapping && mapping[f] !== undefined ? (r[mapping[f] as number] ?? "") : "");
  return p.table.rows.map((r, i) => ({ row: i + 2, name: cell(r, "name"), phone: cell(r, "phone"), email: cell(r, "email") })).filter((l) => l.name || l.phone || l.email);
}

export type PreviewOutcome = { ok: true; preview: PreviewResult } | Refused;

/** Counts, estimate and the first problems: the same words as the API's preview (contract section 1). Test mode's estimate is a plain rule of thumb (2.4 minutes a call, 13 paise a message, 10 paise a minute). */
export function mockPreview(body: PreviewBody): PreviewOutcome {
  const got = parseBody(body);
  if (!got.ok) return got;
  const mapping = body.mapping ?? ("table" in got.parsed ? suggestColumns(got.parsed.table.headers, got.parsed.table.rows).mapping : null);
  const leads = leadsOf(got.parsed, mapping);
  if (leads === "mapping") return { ok: false, error: "mapping_required_missing" };
  const counts: Counts = { ready: 0, duplicates_merged: 0, duplicates_in_file: 0, already_imported: 0, invalid: 0, dnd: 0, no_consent: 0, blocked: 0 };
  const problems: Problem[] = [];
  const note = (row: number, reason: string) => {
    if (problems.length < 50) problems.push({ row, reason });
  };
  const seen = new Set<string>();
  for (const l of leads) {
    const phone = l.phone.trim() === "" ? null : normalizeIndianMobile(l.phone);
    const email = isEmail(l.email) ? l.email.trim().toLowerCase() : null;
    if (phone === null && email === null) {
      counts.invalid += 1;
      note(l.row, l.phone.trim() === "" && l.email.trim() === "" ? "no_contact_way" : "invalid_number");
      continue;
    }
    const key = phone ?? (email as string);
    if (seen.has(key)) {
      counts.duplicates_in_file += 1;
      note(l.row, "duplicate_in_file");
      continue;
    }
    seen.add(key);
    counts.ready += 1;
    if (phone !== null && onFakeDnd(phone)) counts.dnd += 1;
  }
  if (!body.consent_confirmed) counts.no_consent = counts.ready;
  const withConsent = body.consent_confirmed ? counts.ready : 0;
  const minutes = body.consent_confirmed ? Math.round((counts.ready - counts.dnd) * 2.4) : 0;
  return { ok: true, preview: { rows_read: leads.length, source: body.source ?? DEFAULT_TAG[body.kind], counts, estimate: { messages: withConsent, call_minutes: minutes, cost_paise: withConsent * 13 + minutes * 10, basis: "estimate" }, problems, dnd_lookup: "checked" } };
}

/** A short fingerprint of what an import carries (FNV-1a), so the same `import_id` with other content is told apart. Not a secret and not security. */
export function fingerprint(body: PreviewBody): string {
  const s = JSON.stringify([body.kind, body.content_base64, body.text, body.sheet_url, body.mapping, body.source]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
