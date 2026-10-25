import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), put: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/api/call-settings", async (orig) => ({ ...(await orig<typeof import("@/lib/api/call-settings")>()), getCallSettings: (...a: unknown[]) => h.get(...a), putCallSettings: (...a: unknown[]) => h.put(...a) }));

import { ApiRequestError } from "@/lib/api/client";
import { parseCallSettingsOut } from "@/lib/api/call-settings";

import { MOCK_COOKIE, readCallSettings, saveCallSettings } from "./source";
import { defaultCallSettings, enforceSchool, parseCallSettings, purposesFor } from "./types";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const SHOP = defaultCallSettings(null);
const SCHOOL = defaultCallSettings(["programmes"]);

beforeEach(() => {
  h.jar.clear();
  h.get.mockReset();
  h.put.mockReset();
  vi.unstubAllEnvs();
});

describe("call settings (job DP; contract-call-settings.md)", () => {
  it("the defaults are inside every range, for a shop and for a school", () => {
    expect(parseCallSettings(SHOP)).toEqual(SHOP);
    expect(parseCallSettings(SCHOOL)).toEqual(SCHOOL);
  });
  it("a school's defaults: no sales and no payment call, no memory of earlier talk", () => {
    expect(SCHOOL.allowed_purposes).toEqual(["admission_followup", "visit_reminder"]);
    expect(SCHOOL.contact_memory).toBe(false);
    expect(purposesFor(["programmes"])).toEqual(["admission_followup", "visit_reminder", "event_reminder"]);
    expect(purposesFor(["materials"])).toBeNull();
    expect(enforceSchool({ ...SHOP }, purposesFor(["programmes"])).allowed_purposes).toEqual(["visit_reminder"]);
  });
  it("every range of the contract is held: retries, calls at once, silence, the longest call, per week, pausing", () => {
    const bad = [
      { retry_busy: { count: 6, gap_minutes: 30 } }, { retry_busy: { count: 1, gap_minutes: 7 } }, { retry_no_answer: { count: 1, gap_minutes: 2000 } }, { concurrent_calls: 0 }, { concurrent_calls: 21 },
      { silence_timeout_seconds: 2 }, { silence_timeout_seconds: 31 }, { max_call_seconds: 45 }, { max_call_seconds: 1830 }, { interruption_sensitivity: "extreme" }, { voicemail_action: "call_back" }, { phone_menu_action: "leave_message" },
      { max_calls_per_customer_per_week: 0 }, { max_calls_per_customer_per_week: 15 }, { auto_pause_refusals_per_hour: 2 }, { auto_pause_refusals_per_hour: 101 }, { holidays: ["31-12-2026"] }, { holidays: Array(61).fill("2026-12-25") },
      { hours: { days: [1], from_minute: 500, to_minute: 600 } }, { hours: { days: [1], from_minute: 540, to_minute: 1290 } }, { hours: { days: [], from_minute: 540, to_minute: 600 } }, { hours: { days: [1], from_minute: 600, to_minute: 600 } }, { hours: { days: [8], from_minute: 540, to_minute: 600 } },
      { allowed_purposes: ["spam"] }, { allowed_purposes: ["sales_followup", "sales_followup"] }, null,
    ];
    for (const b of bad) expect(parseCallSettings({ ...SHOP, ...(b ?? {}), ...(b === null ? { retry_busy: null } : {}) }), JSON.stringify(b)).toBeNull();
    expect(parseCallSettings({ ...SHOP, auto_pause_refusals_per_hour: null, hours: { days: [6, 1], from_minute: 555, to_minute: 1260 } })).toMatchObject({ auto_pause_refusals_per_hour: null, hours: { days: [1, 6], from_minute: 555, to_minute: 1260 } });
  });
  it("what is spoken or listened for carries no markup or control characters, a name once, a topic to one person, a phone of 7 to 15 digits with an optional +", () => {
    const bad = [
      { pronunciations: [{ written: "<b>", spoken: "x" }] }, { pronunciations: [{ written: "Kanchi", spoken: "a" }, { written: "kanchi", spoken: "b" }] }, { pronunciations: Array.from({ length: 51 }, (_, i) => ({ written: `n${i}`, spoken: "x" })) },
      { keywords: ["a"] }, { keywords: ["x".repeat(41)] }, { keywords: Array(101).fill("word") }, { keywords: ["a{b}"] },
      { handover: [{ topic: "pricing", person_name: "Ravi", phone: "98765" }] }, { handover: [{ topic: "pricing", person_name: "Ravi", phone: "+123" }] }, { handover: [{ topic: "pricing", person_name: "Ravi", phone: "+91 98765 43210" }] }, { handover: [{ topic: "pricing", person_name: "Ravi", phone: "+919876543210" }, { topic: "pricing", person_name: "Asha", phone: "+919876543211" }] }, { handover: [{ topic: "refunds", person_name: "R", phone: "+919876543210" }] },
    ];
    for (const b of bad) expect(parseCallSettings({ ...SHOP, ...b }), JSON.stringify(b)).toBeNull();
    expect(parseCallSettings({ ...SHOP, handover: [{ topic: "pricing", person_name: "Ravi", phone: "9876543210" }] })).not.toBeNull();
    expect(parseCallSettings({ ...SHOP, pronunciations: [{ written: " Kanchipuram ", spoken: "Kanchi-puram" }], keywords: [" pattu "], handover: [{ topic: "pricing", person_name: "Ravi", phone: "+919876543210" }] })).toMatchObject({ pronunciations: [{ written: "Kanchipuram", spoken: "Kanchi-puram" }], keywords: ["pattu"] });
  });
  it("reads the API's answer: the settings, and the purposes a school is held to (from the answer, else from the business type)", () => {
    expect(parseCallSettingsOut({ settings: SHOP, locked: { allowed_purposes: ["visit_reminder"] } }).lockedPurposes).toEqual(["visit_reminder"]);
    expect(parseCallSettingsOut({ settings: SCHOOL }, ["programmes"]).lockedPurposes).toEqual(["admission_followup", "visit_reminder", "event_reminder"]);
    expect(parseCallSettingsOut({ settings: SHOP }).lockedPurposes).toBeNull();
    expect(parseCallSettingsOut({ settings: SHOP, saved: true }).saved).toBe(true);
    expect(parseCallSettingsOut({ settings: SHOP, saved: false }).saved).toBe(false);
    expect(() => parseCallSettingsOut({ settings: { ...SHOP, concurrent_calls: 99 } })).toThrow();
    expect(() => parseCallSettingsOut(null)).toThrow();
  });
  it("C1's own example payloads are read, wherever the file exists", () => {
    const f = join(__dirname, "..", "..", "..", "..", "packages", "contracts", "call_settings.examples.json");
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      return; // the examples come with C1's branch
    }
    for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, { settings?: unknown }>)) if (v && typeof v === "object" && "settings" in v) expect(() => parseCallSettingsOut(v), k).not.toThrow();
  });
});

describe("where call settings come from and go, by the flag", () => {
  it("off: nothing is read or saved", async () => {
    expect(await readCallSettings(CTX, null)).toEqual({ mode: "off" });
    expect(await saveCallSettings(CTX, SHOP, null)).toEqual({ ok: false, error: "not_available" });
  });
  it("mock: the defaults until saved, then what was saved (checked again on every read); a value outside the ranges is refused and nothing is stored", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "mock");
    expect(await readCallSettings(CTX, null)).toMatchObject({ mode: "ok", saved: false });
    expect(await saveCallSettings(CTX, { ...SHOP, concurrent_calls: 3 }, null)).toEqual({ ok: true });
    expect(await readCallSettings(CTX, null)).toMatchObject({ mode: "ok", saved: true, settings: { concurrent_calls: 3 } });
    expect(await saveCallSettings(CTX, { ...SHOP, concurrent_calls: 99 }, null)).toEqual({ ok: false, error: "invalid" });
    h.jar.set(MOCK_COOKIE, "{broken");
    expect(await readCallSettings(CTX, null)).toMatchObject({ saved: false });
    expect(h.get).not.toHaveBeenCalled();
  });
  it("mock: a school cannot save a sales or payment call; a value too big for a cookie is refused", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "mock");
    expect(await saveCallSettings(CTX, { ...SCHOOL, allowed_purposes: ["sales_followup"] }, ["programmes"])).toEqual({ ok: false, error: "locked" });
    expect(await saveCallSettings(CTX, { ...SHOP, keywords: Array.from({ length: 100 }, (_, i) => `${"w".repeat(36)}${String(i).padStart(3, "0")}`) }, null)).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.size).toBe(0);
  });
  it("on: the API's settings with the school's rule applied; a failed read is 'Not available yet'", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "1");
    h.get.mockResolvedValue({ settings: { ...SCHOOL, allowed_purposes: ["sales_followup", "visit_reminder"] }, saved: true, lockedPurposes: purposesFor(["programmes"]) });
    const read = await readCallSettings(CTX, ["programmes"]);
    expect(read).toMatchObject({ mode: "ok", saved: true, settings: { allowed_purposes: ["visit_reminder"] } });
    expect(h.get).toHaveBeenCalledWith("tok", CTX.tenantId, ["programmes"]);
    h.get.mockRejectedValue(new Error("403"));
    expect(await readCallSettings(CTX, null)).toEqual({ mode: "unavailable" });
  });
  it("on: a save goes to the API; the second factor, a locked purpose, a closed plan, a bad value and a failure each say their own thing", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "1");
    h.put.mockResolvedValue(undefined);
    expect(await saveCallSettings(CTX, SHOP, null)).toEqual({ ok: true });
    expect(h.put).toHaveBeenCalledWith("tok", CTX.tenantId, SHOP);
    for (const [status, code, error] of [[403, "mfa_required", "mfa"], [422, "locked_for_business_type", "locked"], [403, "workspace_read_only", "read_only"], [422, "validation_error", "invalid"], [503, "api_unreachable", "not_available"]] as const) {
      h.put.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      expect(await saveCallSettings(CTX, SHOP, null), code).toEqual({ ok: false, error });
    }
    expect(await saveCallSettings(CTX, { nonsense: 1 }, null)).toEqual({ ok: false, error: "invalid" });
  });
});
