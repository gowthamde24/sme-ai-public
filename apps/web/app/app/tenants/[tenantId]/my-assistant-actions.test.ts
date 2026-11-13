import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), act: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/assistant-status/act", () => ({ actOnAssistant: (...a: unknown[]) => h.act(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError } from "@/lib/api/client";

import { goLiveAction, pauseAction } from "./my-assistant-actions";

const T = "66666666-6666-4666-8666-666666666666";
beforeEach(() => {
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.act.mockReset().mockResolvedValue({ ok: true, status: { state: "live", canGoLive: true, missing: [], usingDefaults: [] } });
  h.revalidate.mockReset();
});

describe("Go live and Pause", () => {
  it("only the Owner: an Admin, a viewer or a bad workspace id is refused before anything is asked", async () => {
    for (const role of ["admin", "sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect(await goLiveAction(T)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await pauseAction("nope")).toEqual({ ok: false, error: "forbidden" });
    expect(h.act).not.toHaveBeenCalled();
  });
  it("asks the status layer with the person's own token and redraws the frame (the menu's badge)", async () => {
    expect(await goLiveAction(T)).toEqual({ ok: true, state: "live" });
    expect(h.act).toHaveBeenLastCalledWith("tok", T, "go-live");
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
    h.act.mockResolvedValue({ ok: true, status: { state: "in_training", canGoLive: true, missing: [], usingDefaults: [] } });
    expect(await pauseAction(T)).toEqual({ ok: true, state: "in_training" });
    expect(h.act).toHaveBeenLastCalledWith("tok", T, "pause");
  });
  it("what is missing comes back as its closed words; other refusals keep their word and redraw nothing", async () => {
    h.act.mockResolvedValue({ ok: false, error: "not_ready", missing: ["business_name", "phone_number"] });
    expect(await goLiveAction(T)).toEqual({ ok: false, error: "missing", missing: ["business_name", "phone_number"] });
    h.act.mockResolvedValue({ ok: false, error: "down" });
    expect(await goLiveAction(T)).toEqual({ ok: false, error: "down" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("a lapsed sign-in goes to sign in; an unreadable role is down", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError("out"));
    await expect(goLiveAction(T)).rejects.toThrow("redirect:/login");
    h.tenant.mockRejectedValueOnce(new Error("net"));
    expect(await goLiveAction(T)).toEqual({ ok: false, error: "down" });
  });
});
