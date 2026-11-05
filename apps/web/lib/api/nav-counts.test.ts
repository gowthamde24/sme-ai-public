import { describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { ApiAuthError, ApiRequestError } from "./client";
import { NO_COUNTS, getNavCounts, parseNavCounts, todayCount } from "./nav-counts";

// the contract's own example (docs/contracts/nav-counts.md)
const EXAMPLE = { needs_you: 4, prospects_needing_owner: 16, new_leads: 3, live_calls: 0, unread_chats: 2, followups_due: 5, visits_today: 1, quotes_waiting: 2, ai_team_working: 1, call_minutes: { used: 12, total: 100 }, ai_usage: { used_paise: 410000, allowance_paise: 3000000, period: "month" }, plan: "ai_workforce", as_of: "2026-11-05T11:42:07Z" };
const T = "11111111-1111-4111-8111-111111111111";

describe("the menu's numbers (C1's nav-counts contract)", () => {
  it("reads the contract's example", () => {
    expect(parseNavCounts(EXAMPLE)).toEqual({ needsYou: 4, prospectsNeedingOwner: 16, newLeads: 3, liveCalls: 0, unreadChats: 2, followupsDue: 5, visitsToday: 1, quotesWaiting: 2, aiTeamWorking: 1, callMinutes: { used: 12, total: 100 }, aiUsage: { usedPaise: 410000, allowancePaise: 3000000, period: "month" }, plan: "ai_workforce", asOf: "2026-11-05T11:42:07Z" });
  });
  it("null is 'not known or not for you'; 0 is known, none; one bad field never takes the others with it", () => {
    const c = parseNavCounts({ ...EXAMPLE, quotes_waiting: null, new_leads: -1, unread_chats: 2.5, live_calls: "3", call_minutes: null, ai_usage: { used_paise: 1, allowance_paise: 0, period: "month" }, plan: "<b>" });
    expect([c.quotesWaiting, c.newLeads, c.unreadChats, c.liveCalls, c.callMinutes, c.aiUsage, c.plan]).toEqual([null, null, null, null, null, null, null]);
    expect([c.needsYou, c.followupsDue, c.visitsToday]).toEqual([4, 5, 1]);
    expect(parseNavCounts({ ...EXAMPLE, visits_today: 0 }).visitsToday).toBe(0);
    expect(parseNavCounts("nope")).toEqual(NO_COUNTS);
    expect(parseNavCounts({})).toEqual(NO_COUNTS);
  });
  it("Today's number adds the Lead Finder's businesses (the contract keeps them apart); null only when neither is known", () => {
    expect(todayCount(parseNavCounts(EXAMPLE))).toBe(20);
    expect(todayCount(parseNavCounts({ needs_you: 4 }))).toBe(4);
    expect(todayCount(NO_COUNTS)).toBeNull();
  });
  it("asks with the person's token; a server without the route (404) is 'nothing known'; anything else is thrown", async () => {
    apiRequest.mockResolvedValueOnce(EXAMPLE);
    expect((await getNavCounts("tok", T)).needsYou).toBe(4);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/nav-counts`, "tok");
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getNavCounts("tok", T)).toEqual(NO_COUNTS);
    apiRequest.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(getNavCounts("tok", T)).rejects.toBeInstanceOf(ApiAuthError);
    expect(await getNavCounts("tok", "not-a-workspace")).toEqual(NO_COUNTS);
  });
});
