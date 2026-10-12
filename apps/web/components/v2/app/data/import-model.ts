import type { Say } from "../words";

/** The pure parts of the import screen (job CC): the words for the API's closed codes, the choices that make the mapping, and the checks made before a file is sent. */
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_CSV_BYTES = 1_000_000;
export const SHOWN_ROWS = 100;

/** A sentence for a closed code of the import (a file the API could not read, a bad mapping, a file that is not the one checked), or null: the generic one is used. */
export function importSentence(code: string, t: Say): string | null {
  if (code.startsWith("file_")) {
    const reason = code.slice(5);
    const known = ["empty", "too_large", "not_utf8", "malformed_csv", "too_many_rows", "too_many_columns", "no_header", "not_xlsx", "encrypted", "unreadable", "no_sheet"];
    if (known.includes(reason)) return t(`dta.file.${reason}`);
    if (reason === "too_many_parts" || reason === "unsafe_xml") return t("dta.file.unsafe");
    return t("dta.file.unreadable");
  }
  if (code === "mapping_invalid" || code === "mapping_required_missing") return t("dta.err.mapping");
  if (code === "import_file_changed") return t("dta.err.changed");
  if (code === "integrations_unavailable") return t("dta.err.unavailable");
  if (code === "export_too_large") return t("dta.export.too_large");
  return null;
}

/** What is wrong with a chosen file before it is sent: null when it is fine. */
export function fileProblem(file: { name: string; size: number }, t: Say): string | null {
  if (file.size === 0) return t("dta.file.empty");
  if (file.size > MAX_IMPORT_BYTES) return t("dta.file.big");
  if (/\.csv$/i.test(file.name) && file.size > MAX_CSV_BYTES) return t("dta.file.csvbig");
  return null;
}

/** The choices on screen (field -> column number as text, "" = not used) from the API's guess. */
export function initialChoices(fields: readonly { field: string }[], suggested: Readonly<Record<string, number>>): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.field, f.field in suggested ? String(suggested[f.field]) : ""]));
}

/** The mapping to send: only the fields with a column, and the first required field still without one (or null). */
export function mappingToSend(fields: readonly { field: string; required: boolean }[], choices: Readonly<Record<string, string>>): { mapping: Record<string, number>; missing: string | null } {
  const mapping: Record<string, number> = {};
  let missing: string | null = null;
  for (const f of fields) {
    const v = choices[f.field] ?? "";
    if (v !== "" && /^\d{1,4}$/.test(v)) mapping[f.field] = Number(v);
    else if (f.required && missing === null) missing = f.field;
  }
  return { mapping, missing };
}

/** Two fields may not use the same column: the later choice wins and the earlier one is cleared. */
export function chooseColumn(choices: Readonly<Record<string, string>>, field: string, column: string): Record<string, string> {
  const next = { ...choices, [field]: column };
  if (column !== "") for (const k of Object.keys(next)) if (k !== field && next[k] === column) next[k] = "";
  return next;
}

/** The dictionary key for a closed word, or the key of the generic sentence when this screen has no words for it. */
export function wordKey(t: Say, prefix: string, code: string, fallbackKey: string, known: readonly string[]): string {
  return known.includes(code) ? t(`${prefix}.${code}`) : t(fallbackKey);
}

export const REASONS = ["invalid_row", "unknown_field", "company_name_missing", "contact_requires_email", "contact_name_missing", "contact_domain_not_reserved", "contact_phone_not_reserved", "contact_belongs_to_other_company", "archived_company", "ambiguous_company", "existing_open_lead", "invalid_attribute", "data_rejected", "no_verdict"] as const;
export const NOTES = ["contact_named_after_company", "contact_needs_phone_or_email", "out_of_stock_is_made_to_order"] as const;
export const ISSUES = ["formula_cell", "formula_like", "hidden_characters", "cell_too_long", "company_name_missing", "item_name_missing", "duplicate_in_file", "quantity_invalid", "status_unknown", "no_status_or_quantity"] as const;
export const STATUSES = ["will_create", "duplicate", "needs_review", "rejected", "will_change", "unchanged", "not_found", "ambiguous", "created", "skipped_duplicate"] as const;
export const FIELD_WORDS = ["company_name", "contact_name", "contact_phone", "contact_email", "contact_job_title", "city", "country", "website", "industry", "source", "item_name", "stock_status", "quantity"] as const;
/** The counts shown as figures, in order, for a preview and for a finished import. */
export const PREVIEW_COUNTS = { customers: ["rows", "usable", "will_create", "duplicate", "needs_review", "rejected", "file_problems"], stock: ["rows", "usable", "will_change", "unchanged", "not_found", "ambiguous", "file_problems"] } as const;
export const RESULT_COUNTS = { customers: ["created", "skipped_duplicate", "ambiguous", "rejected", "companies_created", "contacts_created"], stock: ["updated", "unchanged", "not_found", "ambiguous", "missing"] } as const;
