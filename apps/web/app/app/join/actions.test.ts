import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const h = vi.hoisted(() => ({ accept: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/team", async (orig) => ({ ...(await orig<typeof import("@/lib/api/team")>()), acceptInvitation: (...a: unknown[]) => h.accept(...a) }));

import { acceptInvitationAction } from "./actions";

beforeEach(() => h.accept.mockReset().mockResolvedValue({ tenant_id: "t", tenant_name: "Acme", role: "sales" }));

describe("joining with a code", () => {
  it("sends the code as typed with the person's own token", async () => {
    expect(await acceptInvitationAction(" 7qx2k m9r4d ")).toEqual({ ok: true, data: { tenant_id: "t", tenant_name: "Acme", role: "sales" } });
    expect(h.accept).toHaveBeenCalledWith("tok", " 7qx2k m9r4d ");
  });
  it("answers an empty or huge code as 'not valid' without asking", async () => {
    expect(await acceptInvitationAction("  ")).toMatchObject({ ok: false, code: "invitation_invalid" });
    expect(await acceptInvitationAction("x".repeat(101))).toMatchObject({ ok: false, code: "invitation_invalid" });
    expect(h.accept).not.toHaveBeenCalled();
  });
  it("says a refusal in words and keeps the closed code", async () => {
    h.accept.mockRejectedValueOnce(new ApiRequestError(400, "invitation_invalid", "x"));
    expect(await acceptInvitationAction("ABC")).toMatchObject({ ok: false, code: "invitation_invalid" });
    h.accept.mockRejectedValueOnce(new ApiRequestError(429, "invitation_locked", "x"));
    expect(await acceptInvitationAction("ABC")).toMatchObject({ ok: false, kind: "rate_limited", code: "invitation_locked" });
    h.accept.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await acceptInvitationAction("ABC")).toMatchObject({ ok: false, mfa: true });
  });
});
