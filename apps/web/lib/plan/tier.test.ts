import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { finderAccess } from "@/lib/lead-finder/types";
import { planTierScreens } from "@/lib/screens/flag";

const apiRequest = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { ALL_IN, LEAD_DESK, TIERS, TIER_NAMES, mockEntitlements, parseEntitlements } from "./tier";
import { readEntitlements, upgradeHref } from "./tier-source";

const T = "11111111-1111-4111-8111-111111111111";
// C1's draft (docs/contracts/plans-billing.md, "Plans as feature switches"): GET /v1/tenants/{t}/billing/entitlements
const C1_LEAD_DESK = { plan: "calls_300", product: "lead_desk", product_name: { en: "Lead Desk" }, features: { lead_desk: true, lead_finder: false }, upgrade: { product: "ai_workforce", product_name: { en: "AI Workforce" }, features: ["lead_finder"] } };
const C1_AI_WORKFORCE = { plan: "growth", product: "ai_workforce", product_name: { en: "AI Workforce" }, features: { lead_desk: true, lead_finder: true }, upgrade: null };

beforeEach(() => {
  apiRequest.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the upgrade link (C1's #317 says /plans)", () => {
  it("the workspace's plans page while PLAN_SCREENS is on, else Settings -> Plan; nobody else gets a link", () => {
    vi.stubEnv("PLAN_SCREENS", "mock");
    expect(upgradeHref("/app/tenants/x", "owner")).toBe("/app/tenants/x/plans");
    expect(upgradeHref("/app/tenants/x", "admin")).toBe("/app/tenants/x/plans");
    vi.stubEnv("PLAN_SCREENS", "");
    expect(upgradeHref("/app/tenants/x", "owner")).toBe("/app/tenants/x/settings?section=plan");
    expect(upgradeHref("/app/tenants/x", "sales")).toBeNull();
    expect(upgradeHref("/app/tenants/x", "viewer")).toBeNull();
  });
});

describe("the plan tier (owner decision 4 Nov: `ai_workforce` = every feature, `lead_desk` = all but the Lead Finder; the owner sees plan names only)", () => {
  it("reads C1's draft shape and the shorter one C2 proposed", () => {
    // the badge is the owner-facing name of the plan id (lib/plan/names.ts), never the API's product_name ("Lead Desk" / "AI Workforce" are retired names); a plan id with no such name has none
    expect(parseEntitlements(C1_LEAD_DESK)).toEqual({ ...LEAD_DESK, name: "Pro" });
    expect(parseEntitlements(C1_AI_WORKFORCE)).toEqual(ALL_IN);
    expect(parseEntitlements({ ...C1_LEAD_DESK, product_name: { en: "Lead Desk Plus" } })?.name).toBe("Pro");
    expect(parseEntitlements({ ...C1_LEAD_DESK, plan: "calls_payg" })?.name).toBe("Pay as you go");
    expect(parseEntitlements({ ...C1_LEAD_DESK, plan: "something_new" })?.name).toBeNull();
    expect(parseEntitlements({ ...C1_LEAD_DESK, plan: null })?.name).toBeNull();
    expect(parseEntitlements({ tier: "lead_desk", features: { lead_finder: false }, upgrade_to: "ai_workforce" })).toEqual(LEAD_DESK);
    expect(parseEntitlements({ tier: "ai_workforce", features: { lead_finder: true }, upgrade_to: null })).toEqual(ALL_IN);
  });
  it.each([
    ["not an object", "lead_desk"],
    ["no features", { product: "lead_desk" }],
    ["an unknown tier", { product: "gold", features: { lead_finder: false } }],
    ["a plan id where the tier goes", { product: "calls_300", features: { lead_finder: false } }],
    ["a switch that is not true or false", { product: "lead_desk", features: { lead_finder: "no" } }],
    ["an unknown upgrade", { product: "lead_desk", features: { lead_finder: false }, upgrade: { product: "platinum" } }],
  ])("an answer that is %s is not trusted (null)", (_, body) => {
    expect(parseEntitlements(body)).toBeNull();
  });
  it("tier ids are not billing plan ids (scripts/plans_check.py keeps plan ids out of code; the two sets never meet)", () => {
    const plans = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "..", "packages", "plans", "plans.json"), "utf-8")) as { plans: { id: string }[] };
    const ids = plans.plans.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const tier of TIERS) expect(ids).not.toContain(tier);
  });
  it("tier names are names: the same in every language", () => {
    expect(TIER_NAMES).toEqual({ ai_workforce: "With Find customers", lead_desk: "Without Find customers" });
  });
  it("the mock fixture is AI Workforce unless PLAN_TIER_MOCK=lead_desk", () => {
    expect(mockEntitlements(undefined)).toEqual(ALL_IN);
    expect(mockEntitlements("lead_desk")).toEqual(LEAD_DESK);
    expect(mockEntitlements("ai_workforce")).toEqual(ALL_IN);
    expect(mockEntitlements("something")).toEqual(ALL_IN);
  });
});

describe("readEntitlements: flag off / mock / the API", () => {
  it("off (unset): AI Workforce and nothing is asked (nothing changes on staging)", async () => {
    expect(planTierScreens(undefined)).toBe("off");
    expect(await readEntitlements("tok", T, "off")).toEqual(ALL_IN);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("mock: the fixture, no network", async () => {
    vi.stubEnv("PLAN_TIER_MOCK", "lead_desk");
    expect(await readEntitlements("tok", T, "mock")).toEqual(LEAD_DESK);
    vi.stubEnv("PLAN_TIER_MOCK", "");
    expect(await readEntitlements("tok", T, "mock")).toEqual(ALL_IN);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("on: the API's answer, from the workspace's own route with the person's token", async () => {
    apiRequest.mockResolvedValue(C1_LEAD_DESK);
    expect(await readEntitlements("tok", T, "on")).toEqual({ ...LEAD_DESK, name: "Pro" });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/billing/entitlements`, "tok");
  });
  it("on, with a bad answer, no route yet or a failure: AI Workforce (a tier never hides a feature by accident)", async () => {
    apiRequest.mockResolvedValueOnce({ product: "gold" });
    expect(await readEntitlements("tok", T, "on")).toEqual(ALL_IN);
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await readEntitlements("tok", T, "on")).toEqual(ALL_IN);
    apiRequest.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readEntitlements("tok", T, "on")).toEqual(ALL_IN);
    expect(await readEntitlements("tok", "not-a-uuid", "on")).toEqual(ALL_IN);
  });
  it("on: a rejected session is thrown (the page sends the person to sign in)", async () => {
    apiRequest.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(readEntitlements("tok", T, "on")).rejects.toBeInstanceOf(ApiAuthError);
  });
});

describe("what the screens do with the Lead Finder (finderAccess)", () => {
  const ok = { available: true, source: "fixture" as const, reason: "ok" as const };
  it("on where it is available and in the plan", () => expect(finderAccess(ok)).toBe("on"));
  it("upsell only where the API itself says not_in_plan (the web's own tier no longer decides: owner, 18 Nov 2026, every plan has the free searches)", () => {
    expect(finderAccess({ available: false, source: null, reason: "not_in_plan" })).toBe("upsell");
    expect(finderAccess(ok)).toBe("on");
  });
  it("on, with the count, where the free searches are used up", () => {
    expect(finderAccess({ available: true, source: null, reason: "limit_reached", searchesPerMonth: 1, searchesLeft: 0 })).toBe("on");
    expect(finderAccess({ available: false, source: null, reason: "limit_reached" })).toBe("on");
  });
  it("hidden for a business type without it, a Viewer, switched off on AI Workforce, or when it cannot be told", () => {
    expect(finderAccess({ available: false, source: null, reason: "not_for_this_business" })).toBe("hidden");
    expect(finderAccess({ available: false, source: null, reason: "not_for_your_role" })).toBe("hidden");
    expect(finderAccess({ available: false, source: null, reason: "switched_off" })).toBe("hidden");
    expect(finderAccess(null)).toBe("hidden");
    expect(finderAccess(null)).toBe("hidden");
  });
});
