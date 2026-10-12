import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const h = vi.hoisted(() => ({ accept: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/policy", async (orig) => ({ ...(await orig<typeof import("@/lib/api/policy")>()), acceptPolicies: (...a: unknown[]) => h.accept(...a) }));

import { acceptPoliciesAction } from "./actions";

beforeEach(() => h.accept.mockReset().mockResolvedValue({ blocking: false }));

describe("accepting the policies", () => {
  it("sends the versions with the person's token", async () => {
    expect(await acceptPoliciesAction({ terms: "2026-11-01" })).toEqual({ ok: true, data: { blocking: false } });
    expect(h.accept).toHaveBeenCalledWith("tok", { terms: "2026-11-01" });
  });
  it.each([{}, { terms: "" }, { terms: "x y" }, { privacy: "../x" }, { terms: 5 as never }])("refuses %j before asking", async (v) => {
    expect(await acceptPoliciesAction(v)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.accept).not.toHaveBeenCalled();
  });
  it("says that a version has moved on", async () => {
    h.accept.mockRejectedValueOnce(new ApiRequestError(409, "policy_version_outdated", "x"));
    expect(await acceptPoliciesAction({ terms: "old" })).toMatchObject({ ok: false, kind: "conflict", code: "policy_version_outdated" });
  });
});
