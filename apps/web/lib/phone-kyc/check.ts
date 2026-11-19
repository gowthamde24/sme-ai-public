import { B64, DOC_KINDS, FILE_TYPES, MAX_FILE_BYTES, b64Bytes, fieldProblems, normalNumber, type DocKind, type FileType, type KycBody } from "./types";

/**
 * The registration route's check of what the browser sent (the route file may export only handlers, so it lives here). Every field is checked before anything goes on to the API; a field the API does not know is refused, as the API itself would.
 * The file: one of the three kinds, base64 only, not empty, at most 5 MB. Nothing of the document is read beyond its length, and nothing here logs or echoes it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ["kyc_id", "doc_kind", "legal_name", "registration_number", "email", "address_line1", "address_line2", "city", "state", "postal_code", "document"] as const;
const CONTROL = /[\u0000-\u001f\u007f]/g;

export const clean = (v: unknown): string | null => (typeof v === "string" ? v.replace(CONTROL, " ").trim() : null);

/** `bad_body` = not our own form (a plain 400); `field_*` = a typed field the person can fix; `kyc_file_*` = the API's own words for a file. */
export type Checked = { ok: true; body: KycBody } | { ok: false; code: string };

export function checkBody(raw: unknown): Checked {
  const no = (code: string): Checked => ({ ok: false, code });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return no("bad_body");
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(FIELDS as readonly string[]).includes(k))) return no("bad_body");
  const doc = o.document;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return no("bad_body");
  const d = doc as Record<string, unknown>;
  if (Object.keys(d).some((k) => !["name", "content_type", "data_base64"].includes(k))) return no("bad_body");
  if (typeof o.kyc_id !== "string" || !UUID.test(o.kyc_id)) return no("bad_body");
  if (typeof o.doc_kind !== "string" || !(DOC_KINDS as readonly string[]).includes(o.doc_kind)) return no("bad_body");
  const kind = o.doc_kind as DocKind;
  const legal = clean(o.legal_name);
  const number = clean(o.registration_number);
  const email = clean(o.email);
  const a1 = clean(o.address_line1);
  const a2 = clean(o.address_line2 ?? "");
  const city = clean(o.city);
  const state = clean(o.state);
  const postal = clean(o.postal_code);
  if (legal === null || number === null || email === null || a1 === null || a2 === null || city === null || state === null || postal === null) return no("bad_body");
  const problems = fieldProblems({ docKind: kind, number, legal, email, addr1: a1, addr2: a2, city, state, postal });
  const first = (["number", "legal", "email", "addr1", "addr2", "city", "state", "postal"] as const).find((k) => problems[k]);
  if (first) return no(`field_${first}`);
  const name = clean(d.name);
  const data = d.data_base64;
  if (name === null || name.length < 1 || name.length > 99 || typeof d.content_type !== "string" || !(FILE_TYPES as readonly string[]).includes(d.content_type)) return no("kyc_file_type");
  if (typeof data !== "string" || data.length < 4 || data.length % 4 !== 0 || !B64.test(data)) return no("kyc_file_unreadable");
  if (b64Bytes(data) > MAX_FILE_BYTES) return no("kyc_file_too_large");
  return {
    ok: true,
    body: { kyc_id: o.kyc_id.toLowerCase(), doc_kind: kind, legal_name: legal, registration_number: normalNumber(number), email, address_line1: a1, address_line2: a2, city, state, postal_code: postal, document: { name, content_type: d.content_type as FileType, data_base64: data } },
  };
}
