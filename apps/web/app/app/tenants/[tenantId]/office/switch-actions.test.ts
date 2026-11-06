import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), put: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/agent-switches", () => ({ putAgentSwitch: (...a: unknown[]) => h.put(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { setAgentSwitchAction } from "./switch-actions";

const T = "66666666-6666-4666-8666-666666666666";
const ITEM = { agent: "main", enabled: false, canSwitch: true, reasonLocked: null, doneToday: 0 };
beforeEach(() => {
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.put.mockReset().mockResolvedValue(ITEM);
  h.revalidate.mockReset();
});

describe("a helper's switch: the Owner's move", () => {
  it("only the Owner, a known helper and a real yes or no; nothing is sent otherwise", async () => {
    h.tenant.mockResolvedValue({ role: "admin" });
    expect(await setAgentSwitchAction(T, "main", false)).toEqual({ ok: false, error: "forbidden" });
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await setAgentSwitchAction(T, "boss", false)).toEqual({ ok: false, error: "forbidden" });
    expect(await setAgentSwitchAction(T, "main", "no")).toEqual({ ok: false, error: "forbidden" });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("sends it with the person's own token and answers what the API says", async () => {
    expect(await setAgentSwitchAction(T, "main", false)).toEqual({ ok: true, data: ITEM });
    expect(h.put).toHaveBeenCalledWith("tok", T, "main", false);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/office`);
  });
  it("409 is a helper with no switch of its own; anything else is 'down'; a lapsed sign-in signs in again", async () => {
    h.put.mockRejectedValueOnce(new ApiRequestError(409, "not_switchable", "x"));
    expect(await setAgentSwitchAction(T, "quote_writer", false)).toEqual({ ok: false, error: "locked" });
    h.put.mockRejectedValueOnce(new ApiRequestError(500, "x", "x"));
    expect(await setAgentSwitchAction(T, "main", false)).toEqual({ ok: false, error: "down" });
    h.put.mockRejectedValueOnce(new ApiAuthError("out"));
    await expect(setAgentSwitchAction(T, "main", false)).rejects.toThrow("redirect:/login");
  });
});
