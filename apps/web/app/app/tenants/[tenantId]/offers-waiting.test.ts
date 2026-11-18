import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";

const list = vi.fn();
vi.mock("@/lib/api/campaigns", () => ({ listCampaigns: (...a: unknown[]) => list(...a) }));
const flag = vi.fn(() => "on");
vi.mock("@/lib/screens/flag", () => ({ offerScreens: () => flag() }));

import { readOffersWaiting } from "./offers-waiting";

const T = "11111111-1111-4111-8111-111111111111";
const base = `/app/tenants/${T}`;
const offer = (id: string, recipients: number, kind = "offer") => ({ id, kind, recipients });

beforeEach(() => {
  list.mockReset();
  flag.mockReturnValue("on");
});

describe("Today's offers waiting for approval", () => {
  it("one ready offer opens it; several open the Campaigns page", async () => {
    list.mockResolvedValue({ items: [offer("a", 3), offer("b", 0), offer("c", 2, "payment_due")] });
    expect(await readOffersWaiting("tok", T, "owner", base)).toEqual({ count: 1, href: `${base}/campaigns/a` });
    list.mockResolvedValue({ items: [offer("a", 3), offer("d", 5)] });
    expect(await readOffersWaiting("tok", T, "owner", base)).toEqual({ count: 2, href: `${base}/campaigns` });
  });
  it("only the Owner, only with the flag on, nothing when none is ready or the read fails", async () => {
    list.mockResolvedValue({ items: [offer("a", 3)] });
    expect(await readOffersWaiting("tok", T, "admin", base)).toBeNull();
    flag.mockReturnValue("off");
    expect(await readOffersWaiting("tok", T, "owner", base)).toBeNull();
    flag.mockReturnValue("on");
    list.mockResolvedValue({ items: [offer("a", 0)] });
    expect(await readOffersWaiting("tok", T, "owner", base)).toBeNull();
    list.mockRejectedValue(new Error("down"));
    expect(await readOffersWaiting("tok", T, "owner", base)).toBeNull();
  });
  it("a rejected session is thrown", async () => {
    list.mockRejectedValue(new ApiAuthError("401"));
    await expect(readOffersWaiting("tok", T, "owner", base)).rejects.toBeInstanceOf(ApiAuthError);
  });
});
