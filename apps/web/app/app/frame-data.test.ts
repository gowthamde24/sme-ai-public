import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlan = vi.fn();
const getAiUsage = vi.fn();
const readToday = vi.fn();
vi.mock("@/lib/api/plan", () => ({ getPlan: (...a: unknown[]) => getPlan(...a) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: (...a: unknown[]) => getAiUsage(...a) }));
const readPack = vi.fn();
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));
vi.mock("./tenants/[tenantId]/today-read", () => ({ readTodayCached: (...a: unknown[]) => readToday(...a) }));

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
  });
  it("brings in the plan, the usage and the waiting count with the person's token", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: USAGE, waiting: 3, ready: true, showUsage: true, pack: PACK });
    expect(getPlan).toHaveBeenCalledWith("tok", T);
    expect(getAiUsage).toHaveBeenCalledWith("tok", T);
    expect(readToday).toHaveBeenCalledWith("tok", T);
  });
  it("a 403 on the usage (Sales, Viewer) means the card is not drawn, and the rest is still shown", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockRejectedValue(new ApiRequestError(403, "forbidden", "No."));
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: null, waiting: 3, ready: true, showUsage: false, pack: PACK });
  });
  it("any other failure is null for that one part only (so the frame says 'Not available yet' there) and never throws", async () => {
    getPlan.mockRejectedValue(new ApiContractError("x"));
    getAiUsage.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "down"));
    readToday.mockRejectedValue(new ApiAuthError("rejected"));
    expect(await readFrameData("tok", T)).toEqual({ plan: null, usage: null, waiting: null, ready: true, showUsage: true, pack: PACK });
  });
  it("hands the menu of the workspace's business type to the frame, in the person's language", async () => {
    const id = otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!;
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    readPack.mockResolvedValue(workspacePack(id, "signup", ["today", "fees"]));
    const data = await readFrameData("tok", T, "hi");
    expect(data.pack).toMatchObject({ validated: false, coreTab: "fees", modules: ["today", "fees"], name: (packFiles()[id].names as Record<string, string>).hi });
    expect(data.pack?.labels["nav.item.customers"]).toBe(packFiles()[id].labels.hi["nav.item.customers"]);
    expect(data.pack?.labels["pack.core_tab"]).toBe(packFiles()[id].labels.hi["pack.core_tab"]);
    expect(Object.keys(data.pack!.labels).every((k) => k.startsWith("nav.") || k === "pack.core_tab")).toBe(true); // only the menu's words travel to the client
  });
  it("a pack that cannot be read, or a server with no pack routes, is null (the menu the product always had), and nothing else changes", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    readPack.mockRejectedValue(new ApiAuthError("rejected"));
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: USAGE, waiting: 3, ready: true, showUsage: true, pack: null });
  });
});
