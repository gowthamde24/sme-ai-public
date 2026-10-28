import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ accessToken: "the-token" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

import { ApiAuthError } from "@/lib/api/client";

import { browserVoiceTokenAction } from "./browser-voice-actions";

const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_VOICE", "1");
});

describe("browserVoiceTokenAction (the socket's first message needs the sign-in)", () => {
  it.each(["owner", "admin", "sales"])("hands it to the %s of the workspace", async (role) => {
    h.tenant.mockResolvedValue({ role });
    expect(await browserVoiceTokenAction(T)).toEqual({ ok: true, token: "the-token" });
  });
  it("refuses a viewer, a workspace id that is not a uuid, and a server with the flag off, without handing anything over", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect(await browserVoiceTokenAction(T)).toEqual({ ok: false });
    h.tenant.mockResolvedValue({ role: "owner" });
    expect(await browserVoiceTokenAction("x")).toEqual({ ok: false });
    vi.stubEnv("BROWSER_VOICE", "");
    expect(await browserVoiceTokenAction(T)).toEqual({ ok: false });
  });
  it("a workspace that cannot be read is a no; a lost sign-in goes to the sign-in page", async () => {
    h.tenant.mockRejectedValueOnce(new Error("down"));
    expect(await browserVoiceTokenAction(T)).toEqual({ ok: false });
    h.tenant.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(browserVoiceTokenAction(T)).rejects.toThrow("redirect /login");
  });
});
