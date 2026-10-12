import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/team", async (orig) => {
  const real = await orig<typeof import("@/lib/api/team")>();
  const wrap = (n: string) => (...a: unknown[]) => h.api(n, ...a);
  return { ...real, createInvitation: wrap("createInvitation"), revokeInvitation: wrap("revokeInvitation"), changeRole: wrap("changeRole"), removeMember: wrap("removeMember") };
});

import { changeRoleAction, inviteAction, removeMemberAction, revokeInvitationAction } from "./actions";

beforeEach(() => h.api.mockReset().mockResolvedValue({ ok: 1 }));

describe("the team actions", () => {
  it("invite with the person's token and the values as given", async () => {
    expect(await inviteAction(T, I, "sales", 7, "for the cutter")).toEqual({ ok: true, data: { ok: 1 } });
    expect(h.api).toHaveBeenCalledWith("createInvitation", "tok", T, { invitationId: I, role: "sales", days: 7, label: "for the cutter" });
  });
  it("revoke, change a role and remove, each with the person's token", async () => {
    await revokeInvitationAction(T, I);
    expect(h.api).toHaveBeenLastCalledWith("revokeInvitation", "tok", T, I);
    await changeRoleAction(T, U, "viewer");
    expect(h.api).toHaveBeenLastCalledWith("changeRole", "tok", T, U, "viewer");
    await removeMemberAction(T, U, "left");
    expect(h.api).toHaveBeenLastCalledWith("removeMember", "tok", T, U, "left");
  });
  it("refuse bad ids, a long label and fractional days before asking", async () => {
    for (const r of [await inviteAction(T, "x", "sales", 7, ""), await inviteAction("x", I, "sales", 7, ""), await inviteAction(T, I, "sales", 7, "x".repeat(61)), await inviteAction(T, I, "sales", 7.5, ""), await changeRoleAction(T, "x", "sales"), await removeMemberAction("x", U, "left")]) expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.api).not.toHaveBeenCalled();
  });
  it("say a refusal in words and keep its closed code", async () => {
    h.api.mockRejectedValueOnce(new ApiRequestError(403, "role_not_allowed", "x"));
    expect(await inviteAction(T, I, "admin", 7, "")).toMatchObject({ ok: false, kind: "forbidden", code: "role_not_allowed" });
    h.api.mockRejectedValueOnce(new ApiRequestError(409, "keep_owner", "x"));
    expect(await removeMemberAction(T, U, "left")).toMatchObject({ ok: false, kind: "conflict", code: "keep_owner" });
    h.api.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await changeRoleAction(T, U, "admin")).toMatchObject({ ok: false, kind: "mfa", mfa: true });
  });
  it("send a rejected session to sign-in", async () => {
    h.api.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(revokeInvitationAction(T, I)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
