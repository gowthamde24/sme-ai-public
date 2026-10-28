import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), change: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/auto-reply/source", () => ({ changeAutoReply: (...a: unknown[]) => h.change(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError } from "@/lib/api/client";

import { setAutoReplyAction } from "./auto-reply-actions";

const T = "66666666-6666-4666-8666-666666666666";
beforeEach(() => {
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.change.mockReset().mockResolvedValue({ ok: true, data: { enabled: true } });
  h.revalidate.mockReset();
});

describe("the Owner's switch", () => {
  it("only the Owner may change it (an Admin or a bad workspace id is refused before anything is sent)", async () => {
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await setAutoReplyAction(T, true)).toEqual({ ok: false, error: "forbidden" });
    expect(await setAutoReplyAction("nope", true)).toEqual({ ok: false, error: "forbidden" });
    expect(h.change).not.toHaveBeenCalled();
  });
  it("passes the yes or no with the person's own token and redraws Settings; a refusal comes back as its closed word", async () => {
    expect(await setAutoReplyAction(T, true)).toEqual({ ok: true, data: { enabled: true } });
    expect(h.change).toHaveBeenCalledWith({ token: "tok", tenantId: T }, true);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
    h.change.mockResolvedValue({ ok: false, error: "mfa" });
    expect(await setAutoReplyAction(T, true)).toEqual({ ok: false, error: "mfa" });
  });
  it("a lapsed sign-in sends the person to sign in", async () => {
    h.tenant.mockRejectedValue(new ApiAuthError("out"));
    await expect(setAutoReplyAction(T, true)).rejects.toThrow("redirect:/login");
  });
});
