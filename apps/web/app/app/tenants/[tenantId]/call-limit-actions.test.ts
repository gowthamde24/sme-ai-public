import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
const fetchTenant = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
const saveLimit = vi.fn();
vi.mock("@/lib/call-limit/source", () => ({ saveLimit: (...a: unknown[]) => saveLimit(...a) }));

import { saveCallLimitAction } from "./call-limit-actions";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
});

describe("saveCallLimitAction (the Owner only)", () => {
  it("the Owner's number goes to the source", async () => {
    saveLimit.mockResolvedValue({ ok: true, data: { limit: 150, used: 0, remaining: 150, defaultLimit: 100 } });
    expect(await saveCallLimitAction(T, 150)).toMatchObject({ ok: true });
    expect(saveLimit).toHaveBeenCalledWith("tok", T, 150);
  });
  it("another role is refused before the source is asked; a bad workspace id too", async () => {
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await saveCallLimitAction(T, 150)).toEqual({ ok: false, error: "forbidden" });
    expect(await saveCallLimitAction("nope", 150)).toEqual({ ok: false, error: "down" });
    expect(saveLimit).not.toHaveBeenCalled();
  });
});
