import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ make: vi.fn(), revoke: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/data", async (orig) => ({ ...(await orig<typeof import("@/lib/api/data")>()), createCalendarFeed: (...a: unknown[]) => h.make(...a), revokeCalendarFeed: (...a: unknown[]) => h.revoke(...a) }));

import { makeCalendarFeedAction, revokeCalendarFeedAction } from "./data-actions";

beforeEach(() => {
  h.make.mockReset().mockResolvedValue({ url: "https://api.test/v1/calendar/feed/x.ics", webcal: "webcal://api.test/v1/calendar/feed/x.ics", created_at: "2026-10-12T10:00:00Z" });
  h.revoke.mockReset().mockResolvedValue(1);
});

describe("the calendar address actions", () => {
  it("make an address with the person's token and hand it back, once", async () => {
    const r = await makeCalendarFeedAction(T);
    expect(r).toMatchObject({ ok: true, feed: { webcal: expect.stringContaining("webcal://") } });
    expect(h.make).toHaveBeenCalledWith("tok", T);
  });
  it("revoke it", async () => {
    expect(await revokeCalendarFeedAction(T)).toEqual({ ok: true });
    expect(h.revoke).toHaveBeenCalledWith("tok", T);
  });
  it("refuse a workspace id that is not one", async () => {
    expect(await makeCalendarFeedAction("x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await revokeCalendarFeedAction("x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.make).not.toHaveBeenCalled();
  });
  it("say a refusal in words of ours", async () => {
    h.make.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 10));
    expect(await makeCalendarFeedAction(T)).toMatchObject({ ok: false, kind: "rate_limited", retryAfter: 10, error: expect.stringContaining("10 seconds") });
  });
});
