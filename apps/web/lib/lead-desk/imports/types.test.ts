import { describe, expect, it } from "vitest";

import { MAX_BASE64_CHARS, checkImportBody, checkPreviewBody, checkReadBody, checkSheetLinkBody, mappingHasContact, rupeesToPaise, validSheetUrl } from "./types";

const ID = "11111111-1111-4111-8111-111111111111";
const consent = { confirmed: true, list_name: "Open day", purpose: "Tell them about the flats", basis: "explicit_consent", how_collected: "Form at the stall" };
const paste = { kind: "paste", text: "Ravi, 9000000001" };

describe("what the browser may send for the import (checked before it leaves the server)", () => {
  it("accepts a pasted list and keeps only the parts the kind uses", () => {
    expect(checkReadBody({ ...paste, filename: "x.csv", sheet_url: "https://docs.google.com/spreadsheets/d/a", content_base64: "AAAA" })).toEqual({ ok: true, value: { kind: "paste", filename: null, content_base64: null, text: "Ravi, 9000000001", sheet_url: null, use_ai: true } });
  });
  it("refuses a file without content, an unknown kind, junk base64 and extra types", () => {
    expect(checkReadBody({ kind: "file", filename: "a.csv" })).toEqual({ ok: false, error: "invalid" });
    expect(checkReadBody({ kind: "zip", text: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(checkReadBody({ kind: "file", content_base64: "not base64 !!" })).toEqual({ ok: false, error: "invalid" });
    expect(checkReadBody({ kind: "paste", text: 5 })).toEqual({ ok: false, error: "invalid" });
    expect(checkReadBody({ kind: "paste", text: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(checkReadBody(null)).toEqual({ ok: false, error: "invalid" });
  });
  it("a file over 3 MB (as base64) and a text over the limit are 'too large', before anything is sent", () => {
    expect(checkReadBody({ kind: "file", content_base64: "A".repeat(MAX_BASE64_CHARS + 4) })).toEqual({ ok: false, error: "too_large" });
    expect(checkReadBody({ kind: "file", content_base64: "A".repeat(MAX_BASE64_CHARS - 20) }).ok).toBe(true);
    expect(checkReadBody({ kind: "paste", text: "x".repeat(600_001) })).toEqual({ ok: false, error: "too_large" });
  });
  it("a sheet link must be a Google Sheets link", () => {
    expect(validSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=0")).toContain("docs.google.com");
    for (const bad of ["http://docs.google.com/spreadsheets/d/a", "https://evil.example/spreadsheets/d/a", "https://docs.google.com/document/d/a", "javascript:alert(1)", "https://docs.google.com.evil.example/spreadsheets/d/a", "x".repeat(600)]) expect(validSheetUrl(bad), bad).toBeNull();
    expect(checkReadBody({ kind: "sheet", sheet_url: "https://evil.example/x" })).toEqual({ ok: false, error: "sheet_link_invalid" });
  });
  it("the mapping: closed field words, whole column numbers, and a phone or an e-mail", () => {
    const file = { kind: "file", content_base64: "QQ==" };
    expect(checkPreviewBody({ ...file, mapping: { name: 0, phone: 1 } })).toMatchObject({ ok: true, value: { mapping: { name: 0, phone: 1 } } });
    expect(checkPreviewBody({ ...file, mapping: { name: 0 } })).toEqual({ ok: false, error: "mapping_required_missing" });
    expect(checkPreviewBody({ ...file, mapping: { phone: -1 } })).toEqual({ ok: false, error: "invalid" });
    expect(checkPreviewBody({ ...file, mapping: { phone: 1.5 } })).toEqual({ ok: false, error: "invalid" });
    expect(checkPreviewBody({ ...file, mapping: { telephone: 1 } })).toEqual({ ok: false, error: "invalid" });
    expect(checkPreviewBody({ ...file, mapping: [1] })).toEqual({ ok: false, error: "invalid" });
    expect(mappingHasContact({ email: 2 })).toBe(true);
    expect(mappingHasContact({})).toBe(false);
    expect(mappingHasContact(null)).toBe(false);
  });
  it("a pasted list ignores any mapping that was sent", () => {
    expect(checkPreviewBody({ ...paste, mapping: { phone: 1 } })).toMatchObject({ ok: true, value: { mapping: null } });
  });
  it("the source tag must be one the kind may take", () => {
    expect(checkPreviewBody({ ...paste, source: "justdial" }).ok).toBe(true);
    expect(checkPreviewBody({ ...paste, source: "pasted_list" }).ok).toBe(true);
    expect(checkPreviewBody({ ...paste, source: "excel_upload" }).ok).toBe(false);
    expect(checkPreviewBody({ ...paste, source: "made_up" }).ok).toBe(false);
  });
  it("an import needs an id of the right shape, a whole consent or none, and a cost in range", () => {
    expect(checkImportBody({ ...paste, import_id: ID, consent })).toMatchObject({ ok: true, value: { import_id: ID, consent_confirmed: true } });
    expect(checkImportBody({ ...paste, import_id: ID, consent: null, consent_confirmed: true })).toMatchObject({ ok: true, value: { consent_confirmed: false } });
    expect(checkImportBody({ ...paste, import_id: "nope" }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, consent: { ...consent, purpose: "" } }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, consent: { ...consent, basis: "because" } }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, consent: { ...consent, confirmed: false } }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, consent: { ...consent, list_name: "x".repeat(121) } }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, cost_per_lead_paise: 1200 })).toMatchObject({ ok: true, value: { cost_per_lead_paise: 1200 } });
    expect(checkImportBody({ ...paste, import_id: ID, cost_per_lead_paise: -1 }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, cost_per_lead_paise: 10_000_001 }).ok).toBe(false);
    expect(checkImportBody({ ...paste, import_id: ID, cost_per_lead_paise: 1.5 }).ok).toBe(false);
  });
  it("a kept sheet needs its link id, a Sheets address and a mapping with a phone or e-mail", () => {
    const body = { link_id: ID, sheet_url: "https://docs.google.com/spreadsheets/d/abc", mapping: { phone: 1 }, consent: null, cost_per_lead_paise: null };
    expect(checkSheetLinkBody(body).ok).toBe(true);
    expect(checkSheetLinkBody({ ...body, mapping: { name: 0 } })).toEqual({ ok: false, error: "mapping_required_missing" });
    expect(checkSheetLinkBody({ ...body, mapping: null }).ok).toBe(false);
    expect(checkSheetLinkBody({ ...body, sheet_url: "https://evil.example" })).toEqual({ ok: false, error: "sheet_link_invalid" });
    expect(checkSheetLinkBody({ ...body, link_id: "x" }).ok).toBe(false);
  });
});

describe("cost per lead: rupees to paise", () => {
  it("writes whole rupees and up to two decimals, nothing else", () => {
    expect(rupeesToPaise("12")).toBe(1200);
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("₹ 1,250.75")).toBe(125_075);
    expect(rupeesToPaise("0")).toBe(0);
    expect(rupeesToPaise("")).toBeUndefined();
    expect(rupeesToPaise("  ")).toBeUndefined();
    for (const bad of ["abc", "12.345", "-5", "1e3", "100001", "12,50,00,000"]) expect(rupeesToPaise(bad), bad).toBeNull();
  });
});
