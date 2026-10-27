import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: vi.fn(), revalidate: vi.fn(), mode: "on" as string,
  read: vi.fn(), preview: vi.fn(), imp: vi.fn(), link: vi.fn(), act: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => h.redirect(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok-1" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/lead-desk/imports/source", () => ({
  importMode: () => h.mode,
  readStep: (...a: unknown[]) => h.read(...a),
  previewStep: (...a: unknown[]) => h.preview(...a),
  importStep: (...a: unknown[]) => h.imp(...a),
  makeSheetLink: (...a: unknown[]) => h.link(...a),
  actOnLink: (...a: unknown[]) => h.act(...a),
}));

import { ApiAuthError } from "@/lib/api/client";
import { MAX_BASE64_CHARS } from "@/lib/lead-desk/imports/types";

import { createSheetLinkAction, importLeadsAction, previewLeadsAction, readLeadsAction, sheetLinkAction } from "./import-actions";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";
const paste = { kind: "paste", text: "Ravi, 9000000001" };
const consent = { confirmed: true, list_name: "Open day", purpose: "Flats", basis: "explicit_consent", how_collected: "Form" };
const sheet = { link_id: ID, sheet_url: "https://docs.google.com/spreadsheets/d/a", mapping: { phone: 1 }, consent: null, cost_per_lead_paise: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.mode = "on";
  h.tenant.mockResolvedValue({ role: "owner" });
  h.read.mockResolvedValue({ ok: true, data: { rows: 1 } });
  h.preview.mockResolvedValue({ ok: true, data: { rows_read: 1 } });
  h.imp.mockResolvedValue({ ok: true, data: { import_id: ID, source: "pasted_list" } });
  h.link.mockResolvedValue({ ok: true, data: { id: ID } });
  h.act.mockResolvedValue({ ok: true, data: { id: ID } });
});

describe("the import steps (night 4, Lead Desk): who may do what", () => {
  it("Owner, Admin and Sales read, preview and import with the person's own token", async () => {
    for (const role of ["owner", "admin", "sales"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await readLeadsAction(T, paste)).toEqual({ ok: true, data: { rows: 1 } });
      expect(await previewLeadsAction(T, paste)).toMatchObject({ ok: true });
      expect(await importLeadsAction(T, { ...paste, import_id: ID })).toMatchObject({ ok: true });
    }
    expect(h.read).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, expect.objectContaining({ kind: "paste", text: "Ravi, 9000000001" }));
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/import`);
  });
  it("a Viewer, a stranger's workspace and a bad id reach nothing", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await readLeadsAction(T, paste)).toEqual({ ok: false, error: "forbidden" });
    expect(await previewLeadsAction(T, paste)).toEqual({ ok: false, error: "forbidden" });
    expect(await importLeadsAction(T, { ...paste, import_id: ID })).toEqual({ ok: false, error: "forbidden" });
    expect(await createSheetLinkAction(T, sheet)).toEqual({ ok: false, error: "forbidden" });
    expect(await sheetLinkAction(T, ID, "sync")).toEqual({ ok: false, error: "forbidden" });
    h.tenant.mockRejectedValueOnce(new Error("404"));
    expect(await readLeadsAction(T, paste)).toEqual({ ok: false, error: "not_available" });
    expect(await readLeadsAction("x", paste)).toEqual({ ok: false, error: "not_available" });
    for (const f of [h.read, h.preview, h.imp, h.link, h.act]) expect(f).not.toHaveBeenCalled();
  });
  it("a Sales member can import, but the consent confirmation is the Owner's and the Admin's word", async () => {
    h.tenant.mockResolvedValue({ role: "sales" });
    expect(await importLeadsAction(T, { ...paste, import_id: ID, consent })).toEqual({ ok: false, error: "consent_owner_only" });
    expect(await previewLeadsAction(T, { ...paste, consent_confirmed: true })).toEqual({ ok: false, error: "consent_owner_only" });
    expect(h.imp).not.toHaveBeenCalled();
    expect(h.preview).not.toHaveBeenCalled();
    expect(await importLeadsAction(T, { ...paste, import_id: ID })).toMatchObject({ ok: true });
    expect(h.imp.mock.calls[0][1]).toMatchObject({ consent: null, consent_confirmed: false });
    for (const role of ["owner", "admin"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await importLeadsAction(T, { ...paste, import_id: ID, consent })).toMatchObject({ ok: true });
    }
    expect(h.imp.mock.calls.at(-1)?.[1]).toMatchObject({ consent: { list_name: "Open day" }, consent_confirmed: true });
  });
  it("kept sheets are for the Owner and the Admin only", async () => {
    h.tenant.mockResolvedValue({ role: "sales" });
    expect(await createSheetLinkAction(T, sheet)).toEqual({ ok: false, error: "forbidden" });
    expect(await sheetLinkAction(T, ID, "pause")).toEqual({ ok: false, error: "forbidden" });
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await createSheetLinkAction(T, sheet)).toMatchObject({ ok: true });
    expect(await sheetLinkAction(T, ID, "sync")).toMatchObject({ ok: true });
    expect(h.act).toHaveBeenCalledWith({ token: "tok-1", tenantId: T }, ID, "sync");
    expect(await sheetLinkAction(T, "bad", "sync")).toEqual({ ok: false, error: "invalid" });
    expect(await sheetLinkAction(T, ID, "delete" as never)).toEqual({ ok: false, error: "invalid" });
  });
  it("answers 'not available' when the flag is off, and calls nothing", async () => {
    h.mode = "off";
    expect(await readLeadsAction(T, paste)).toEqual({ ok: false, error: "not_available" });
    expect(await importLeadsAction(T, { ...paste, import_id: ID })).toEqual({ ok: false, error: "not_available" });
    expect(await createSheetLinkAction(T, sheet)).toEqual({ ok: false, error: "not_available" });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

describe("the import steps: bad input never leaves the server", () => {
  it("a file over 3 MB is 'too large' and nothing is called", async () => {
    expect(await readLeadsAction(T, { kind: "file", content_base64: "A".repeat(MAX_BASE64_CHARS + 8) })).toEqual({ ok: false, error: "too_large" });
    expect(h.read).not.toHaveBeenCalled();
  });
  it("a mapping without a phone or an e-mail, an unknown field and junk are refused", async () => {
    const file = { kind: "file", content_base64: "QQ==" };
    expect(await previewLeadsAction(T, { ...file, mapping: { name: 0 } })).toEqual({ ok: false, error: "mapping_required_missing" });
    expect(await previewLeadsAction(T, { ...file, mapping: { zip: 0 } })).toEqual({ ok: false, error: "invalid" });
    expect(await importLeadsAction(T, { ...file, mapping: { phone: 0 }, import_id: "nope" })).toEqual({ ok: false, error: "invalid" });
    expect(await importLeadsAction(T, { ...file, mapping: { phone: 0 }, import_id: ID, consent: { ...consent, basis: "x" } })).toEqual({ ok: false, error: "invalid" });
    expect(await readLeadsAction(T, "not an object")).toEqual({ ok: false, error: "invalid" });
    expect(await readLeadsAction(T, { kind: "sheet", sheet_url: "https://evil.example/x" })).toEqual({ ok: false, error: "sheet_link_invalid" });
    for (const f of [h.read, h.preview, h.imp]) expect(f).not.toHaveBeenCalled();
  });
  it("a refusal from below is passed on and nothing is refreshed", async () => {
    h.imp.mockResolvedValueOnce({ ok: false, error: "read_only" });
    expect(await importLeadsAction(T, { ...paste, import_id: ID })).toEqual({ ok: false, error: "read_only" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("an expired sign-in goes to the login page", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(readLeadsAction(T, paste)).rejects.toThrow("redirect:/login");
    h.read.mockRejectedValueOnce(new ApiAuthError());
    await expect(readLeadsAction(T, paste)).rejects.toThrow("redirect:/login");
  });
});
