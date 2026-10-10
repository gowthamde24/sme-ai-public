import { describe, expect, it, vi } from "vitest";

const getPlan = vi.fn();
const getAiUsage = vi.fn();
const readToday = vi.fn();
vi.mock("@/lib/api/plan", () => ({ getPlan: (...a: unknown[]) => getPlan(...a) }));
vi.mock("@/lib/api/ai-usage", () => ({ getAiUsage: (...a: unknown[]) => getAiUsage(...a) }));
vi.mock("./tenants/[tenantId]/today-read", () => ({ readTodayCached: (...a: unknown[]) => readToday(...a) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";

import { readFrameData } from "./frame-data";

const PLAN = { plan: "free_trial", workspace_limit: 1, trial_started_at: "2026-10-09T10:00:00Z" };
const USAGE = { spent_paise: 15, cap_paise: 200, left_paise: 185 };
const TODAY = { cards: { waiting: 3, money_held_paise: 0, orders_open: 1 }, needs_you: [], recent: [] };
const T = "22222222-2222-2222-2222-222222222222";

describe("readFrameData", () => {
  it("brings in the plan, the usage and the waiting count with the person's token", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockResolvedValue(USAGE);
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: USAGE, waiting: 3, ready: true, showUsage: true });
    expect(getPlan).toHaveBeenCalledWith("tok", T);
    expect(getAiUsage).toHaveBeenCalledWith("tok", T);
    expect(readToday).toHaveBeenCalledWith("tok", T);
  });
  it("a 403 on the usage (Sales, Viewer) means the card is not drawn, and the rest is still shown", async () => {
    getPlan.mockResolvedValue(PLAN);
    getAiUsage.mockRejectedValue(new ApiRequestError(403, "forbidden", "No."));
    readToday.mockResolvedValue(TODAY);
    expect(await readFrameData("tok", T)).toEqual({ plan: PLAN, usage: null, waiting: 3, ready: true, showUsage: false });
  });
  it("any other failure is null for that one part only (so the frame says 'Not available yet' there) and never throws", async () => {
    getPlan.mockRejectedValue(new ApiContractError("x"));
    getAiUsage.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "down"));
    readToday.mockRejectedValue(new ApiAuthError("rejected"));
    expect(await readFrameData("tok", T)).toEqual({ plan: null, usage: null, waiting: null, ready: true, showUsage: true });
  });
});
