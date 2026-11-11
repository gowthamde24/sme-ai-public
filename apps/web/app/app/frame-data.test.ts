import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlan = vi.fn();
const getAiUsage = vi.fn();
const readToday = vi.fn();
const getWorkspaceProfile = vi.fn();
vi.mock("@/lib/api/workspace", () => ({ getWorkspaceProfile: (...a: unknown[]) => getWorkspaceProfile(...a) }));
const LOGO = "https://s.example/logo.png?sig=1";
vi.mock("@/lib/api/plan", () => ({ getPlan: (...a: unknown[]) => getPlan(...a) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: (...a: unknown[]) => getAiUsage(...a) }));
const readPack = vi.fn();
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));
vi.mock("./tenants/[tenantId]/today-read", () => ({ readTodayCached: (...a: unknown[]) => readToday(...a) }));
const readAvailability = vi.fn();
vi.mock("@/lib/api/lead-finder", () => ({ readAvailability: (...a: unknown[]) => readAvailability(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";

import { defaultWorkspacePack, otherPackIds, packFiles, workspacePack } from "@/lib/packs/pack-test-kit";
import { packFrame } from "@/lib/packs/resolve";

import { readFrameData } from "./frame-data";

const FIXTURE = defaultWorkspacePack();
const PACK = packFrame(FIXTURE, "en");

const PLAN = { plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" };
const USAGE = { spent_paise: 15, cap_paise: 200, left_paise: 185 };
const TODAY = { cards: { waiting: 3, money_held_paise: 0, orders_open: 1 }, needs_you: [], recent: [] };
const T = "22222222-2222-2222-2222-222222222222";

describe("readFrameData", () => {
  beforeEach(() => {
    readPack.mockResolvedValue(FIXTURE);
    getWorkspaceProfile.mockResolvedValue({ logoUrl: LOGO });
    readAvailability.mockResolvedValue({ available: true, source: "fixture", reason: "ok" });
  });
  it("brings in the plan, the usage and the waiting count with the person's token", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: USAGE, waiting: 3, ready: true, showUsage: true, live: false, logoUrl: LOGO, pack: PACK , v4: false });
    expect(getPlan).toHaveBeenCalledWith("tok", T);
    expect(getAiUsage).toHaveBeenCalledWith("tok", T);
    expect(readToday).toHaveBeenCalledWith("tok", T);
  });
  it("a 403 on the usage (Sales, Viewer) means the card is not drawn, and the rest is still shown", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockRejectedValue(new ApiRequestError(403, "forbidden", "No."));
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: null, waiting: 3, ready: true, showUsage: false, live: false, logoUrl: LOGO, pack: PACK , v4: false });
  });
  it("any other failure is null for that one part only (so the frame says 'Not available yet' there) and never throws", async () => {
    getPlan.mockRejectedValue(new ApiContractError("x"));
    getAiUsage.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "down"));
    readToday.mockRejectedValue(new ApiAuthError("rejected"));
    getWorkspaceProfile.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "down"));
    expect(await readFrameData("tok", T)).toEqual({ plan: null, usage: null, waiting: null, ready: true, showUsage: true, live: false, logoUrl: null, pack: PACK , v4: false });
  });
  it("hands the menu of the workspace's business type to the frame, in the person's language", async () => {
    const id = otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!;
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    readPack.mockResolvedValue(workspacePack(id, "signup", ["today", "fees"]));
    // what the API says for this business type today (the Lead Finder is added where it says available: see the school test below)
    readAvailability.mockResolvedValue({ available: false, source: null, reason: "not_for_this_business" });
    const data = await readFrameData("tok", T, "hi");
    expect(data.pack).toMatchObject({ validated: false, coreTab: "fees", modules: ["today", "fees"], name: (packFiles()[id].names as Record<string, string>).hi });
    expect(data.pack?.labels["nav.item.customers"]).toBe(packFiles()[id].labels.hi["nav.item.customers"]);
    expect(data.pack?.labels["pack.core_tab"]).toBe(packFiles()[id].labels.hi["pack.core_tab"]);
    expect(Object.keys(data.pack!.labels).every((k) => k.startsWith("nav.") || k === "pack.core_tab")).toBe(true); // only the menu's words travel to the client
  });
  it("app v4 (APP_V4=1) is in the frame, so the menu becomes the five groups; unset, it is off", async () => {
    vi.stubEnv("APP_V4", "1");
    expect((await readFrameData("tok", T)).v4).toBe(true);
    vi.stubEnv("APP_V4", "");
    expect((await readFrameData("tok", T)).v4).toBe(false);
    vi.unstubAllEnvs();
  });
  it("a pack that cannot be read, or a server with no pack routes, is null (the menu the product always had), and nothing else changes", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    readPack.mockRejectedValue(new ApiAuthError("rejected"));
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: USAGE, waiting: 3, ready: true, showUsage: true, live: false, logoUrl: LOGO, pack: null , v4: false });
  });
  it("keeps the Lead Finder's tab only where the API says it is available (switched off, or cannot be told: the module is dropped from the menu)", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    expect(FIXTURE.modules).toContain("lead_finder");
    expect((await readFrameData("tok", T)).pack?.modules).toContain("lead_finder");
    expect(readAvailability).toHaveBeenCalledWith("tok", T);
    readAvailability.mockResolvedValue({ available: false, source: null, reason: "switched_off" });
    const off = await readFrameData("tok", T);
    expect(off.pack?.modules).not.toContain("lead_finder");
    expect(off.pack?.modules.length).toBe(PACK.modules.length - 1);
    readAvailability.mockResolvedValue(null);
    expect((await readFrameData("tok", T)).pack?.modules).not.toContain("lead_finder");
    readAvailability.mockRejectedValue(new ApiAuthError("rejected"));
    expect((await readFrameData("tok", T)).pack?.modules).not.toContain("lead_finder");
  });
  it("a school gets the Lead Finder's tab only where the API says it is available (its pack lists the module since #319), and the tab says Find organisations", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    const school = workspacePack("education");
    readPack.mockResolvedValue(school);
    readAvailability.mockResolvedValue({ available: false, source: null, reason: "not_for_this_business" });
    expect((await readFrameData("tok", T)).pack?.modules).not.toContain("lead_finder");
    readAvailability.mockResolvedValue({ available: true, source: "fixture", reason: "ok", audience: "organisations" });
    const on = await readFrameData("tok", T, "en");
    expect(on.pack?.modules).toContain("lead_finder");
    expect(on.pack?.labels["nav.item.retailers"]).toBe("Find organisations");
    expect((await readFrameData("tok", T, "te")).pack?.labels["nav.item.retailers"]).toBe("సంస్థలను వెతకండి");
    // an older API without `audience`: the school fallback still says organisations
    readAvailability.mockResolvedValue({ available: true, source: "fixture", reason: "ok" });
    expect((await readFrameData("tok", T, "en")).pack?.labels["nav.item.retailers"]).toBe("Find organisations");
    // a business keeps its pack's own word
    readPack.mockResolvedValue(FIXTURE);
    expect((await readFrameData("tok", T, "en")).pack?.labels["nav.item.retailers"]).toBe(PACK.labels["nav.item.retailers"]);
  });
});
