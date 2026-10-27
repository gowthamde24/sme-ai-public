import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, unknown>(), importLeads: vi.fn(), readLeads: vi.fn() }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (name: string, parse: (v: unknown) => unknown, fallback: unknown) => (h.jar.has(name) ? (parse(JSON.parse(JSON.stringify(h.jar.get(name)))) ?? fallback) : fallback),
  writeJar: async (name: string, value: unknown) => (JSON.stringify(value).length > 3500 ? false : (h.jar.set(name, value), true)),
}));
vi.mock("@/lib/api/lead-imports", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lead-imports")>()), importLeads: (...a: unknown[]) => h.importLeads(...a), readLeads: (...a: unknown[]) => h.readLeads(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { actOnLink, importStep, makeSheetLink, readStep, recentImports, sheetState } from "./source";
import type { ImportBody } from "./types";

const ctx = { token: "t", tenantId: "22222222-2222-4222-8222-222222222222" };
const ID = "11111111-1111-4111-8111-111111111111";
const body = (text: string, extra: Partial<ImportBody> = {}): ImportBody => ({ kind: "paste", filename: null, content_base64: null, text, sheet_url: null, use_ai: true, mapping: null, source: null, consent_confirmed: false, import_id: ID, consent: null, cost_per_lead_paise: null, ...extra });
const consent = { confirmed: true as const, list_name: "Open day", purpose: "Flats", basis: "explicit_consent" as const, how_collected: "Form" };
const NOW = new Date("2026-10-26T10:00:00Z");

beforeEach(() => {
  h.jar.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.LEADS_SCREENS;
});

describe("the import source: off, test mode and the API", () => {
  it("off answers 'not available' to everything", async () => {
    expect(await readStep(ctx, body("x"))).toEqual({ ok: false, error: "not_available" });
    expect(await importStep(ctx, body("x"))).toEqual({ ok: false, error: "not_available" });
    expect(await recentImports(ctx)).toEqual({ mode: "off" });
  });
  it("the API: a read-only workspace, a reused id and the real-data gate become closed words", async () => {
    process.env.LEADS_SCREENS = "1";
    h.importLeads.mockRejectedValueOnce(new ApiRequestError(403, "workspace_read_only", "x"));
    expect(await importStep(ctx, body("Ravi, 9000000001"))).toEqual({ ok: false, error: "read_only" });
    h.importLeads.mockRejectedValueOnce(new ApiRequestError(409, "import_id_used", "x"));
    expect(await importStep(ctx, body("Ravi, 9000000001"))).toEqual({ ok: false, error: "import_id_used" });
    h.readLeads.mockRejectedValueOnce(new ApiRequestError(422, "sheet_refused", "x", "encrypted"));
    expect(await readStep(ctx, body("x"))).toEqual({ ok: false, error: "sheet_refused", reason: "encrypted" });
    h.readLeads.mockRejectedValueOnce(new ApiRequestError(422, "real_data_gate", "x"));
    expect(await readStep(ctx, body("x"))).toEqual({ ok: false, error: "real_data_gate" });
  });
  it("test mode: an import is kept in the one cookie, listed, and a repeat of the same id answers the same without a second row", async () => {
    process.env.LEADS_SCREENS = "mock";
    const first = await importStep(ctx, body("Ravi, 9000000001\nAnitha, 9000000002\nRavi again, 9000000001"), NOW);
    expect(first).toMatchObject({ ok: true, data: { import_id: ID, status: "done", source: "pasted_list", consent_id: null, counts: { ready: 2, duplicates_in_file: 1, no_consent: 2 } } });
    const again = await importStep(ctx, body("Ravi, 9000000001\nAnitha, 9000000002\nRavi again, 9000000001"), new Date("2026-10-26T11:00:00Z"));
    expect(again).toEqual(first);
    const list = await recentImports(ctx);
    expect(list.mode === "ok" && list.items).toHaveLength(1);
    expect(list.mode === "ok" && list.test).toBe(true);
  });
  it("test mode: other content under the same id is refused", async () => {
    process.env.LEADS_SCREENS = "mock";
    await importStep(ctx, body("Ravi, 9000000001"), NOW);
    expect(await importStep(ctx, body("Someone else, 9000000005"), NOW)).toEqual({ ok: false, error: "import_id_used" });
  });
  it("test mode: the consent is stored as a confirmation (no leads without consent when it is missing)", async () => {
    process.env.LEADS_SCREENS = "mock";
    const withConsent = await importStep(ctx, body("Ravi, 9000000001", { consent }), NOW);
    expect(withConsent).toMatchObject({ ok: true, data: { counts: { ready: 1, no_consent: 0 } } });
    expect(withConsent.ok && withConsent.data.consent_id).toMatch(/^00000000-0000-4000-8000-/);
  });
  it("test mode keeps only the five latest and never overflows the cookie", async () => {
    process.env.LEADS_SCREENS = "mock";
    for (let i = 0; i < 7; i += 1) await importStep(ctx, body(`Ravi, 90000000${String(i).padStart(2, "0")}`, { import_id: `11111111-1111-4111-8111-11111111111${i}` }), NOW);
    const list = await recentImports(ctx);
    expect(list.mode === "ok" && list.items.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(h.jar.get("sme_leadimports_mock")).length).toBeLessThan(3500);
  });
  it("test mode: kept sheets can be made, synced, paused and resumed; a private sheet or a missing phone is refused", async () => {
    process.env.LEADS_SCREENS = "mock";
    const link = { link_id: ID, sheet_url: "https://docs.google.com/spreadsheets/d/abc", mapping: { phone: 1 }, consent: null, cost_per_lead_paise: null };
    expect(await makeSheetLink(ctx, { ...link, mapping: { name: 0 } }, NOW)).toEqual({ ok: false, error: "mapping_required_missing" });
    expect(await makeSheetLink(ctx, { ...link, sheet_url: "https://docs.google.com/spreadsheets/d/private" }, NOW)).toEqual({ ok: false, error: "sheet_not_public" });
    expect(await makeSheetLink(ctx, link, NOW)).toMatchObject({ ok: true, data: { id: ID, status: "active", last_synced_at: null } });
    expect(await makeSheetLink(ctx, link, NOW)).toMatchObject({ ok: true, data: { id: ID } });
    expect(await actOnLink(ctx, ID, "sync", NOW)).toMatchObject({ ok: true, data: { last_synced_at: NOW.toISOString(), last_row_count: 6 } });
    expect(await actOnLink(ctx, ID, "pause", NOW)).toMatchObject({ ok: true, data: { status: "paused" } });
    expect(await actOnLink(ctx, ID, "resume", NOW)).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await actOnLink(ctx, "99999999-9999-4999-8999-999999999999", "pause", NOW)).toEqual({ ok: false, error: "not_available" });
    const state = await sheetState(ctx);
    expect(state.mode === "ok" && state.links).toHaveLength(1);
    expect(state.mode === "ok" && state.access.modes.find((m) => m.mode === "service_account")?.available).toBe(false);
  });
});
