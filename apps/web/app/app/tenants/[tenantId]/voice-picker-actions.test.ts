import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const save = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/voice-picker/source", () => ({ saveVoiceChoice: (...a: unknown[]) => save(...a) }));

import { chooseVoiceAction } from "./voice-picker-actions";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ accessToken: "tok" });
  fetchTenant.mockResolvedValue({ role: "owner" });
  save.mockResolvedValue({ ok: true, data: {} });
});

describe("the voice picker's move", () => {
  it("the Owner and an Admin choose a voice (or null for the default) and the settings page is read again", async () => {
    expect(await chooseVoiceAction(T, "hi", "hi-esha")).toEqual({ ok: true });
    expect(save).toHaveBeenCalledWith({ token: "tok", tenantId: T }, "hi", "hi-esha");
    fetchTenant.mockResolvedValue({ role: "admin" });
    expect(await chooseVoiceAction(T, "hi", null)).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/settings`);
  });
  it("Sales and Viewers, and a workspace id that is not a uuid, are refused without a request", async () => {
    fetchTenant.mockResolvedValue({ role: "sales" });
    expect(await chooseVoiceAction(T, "hi", null)).toEqual({ ok: false, error: "forbidden" });
    expect(await chooseVoiceAction("nope", "hi", null)).toEqual({ ok: false, error: "forbidden" });
    expect(save).not.toHaveBeenCalled();
  });
  it("the source's refusal is passed on as its closed word; a rejected session goes to sign in", async () => {
    save.mockResolvedValue({ ok: false, error: "invalid" });
    expect(await chooseVoiceAction(T, "hi", "x")).toEqual({ ok: false, error: "invalid" });
    fetchTenant.mockRejectedValue(new ApiAuthError());
    await expect(chooseVoiceAction(T, "hi", null)).rejects.toThrow("redirect:/login");
  });
});
