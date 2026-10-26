import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), post: vi.fn(), req: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/api/ai-assistant", async (orig) => ({ ...(await orig<typeof import("@/lib/api/ai-assistant")>()), postTestCall: (...a: unknown[]) => h.post(...a) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { assistantProfile } from "./defaults";
import { MOCK_COOKIE, saveAssistant, testCall } from "./source";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const call = { note: "n", transcript: [{ speaker: "assistant" as const, text: "Hi" }], outcome: null };

beforeEach(() => {
  h.jar.clear();
  h.post.mockReset();
  h.req.mockReset();
  vi.unstubAllEnvs();
});

describe("the simulated test call (job DQ part 3)", () => {
  it("is not there while the screens are off", async () => {
    expect(await testCall(CTX, "Acme", null)).toEqual({ ok: false, error: "not_available" });
  });
  it("mock: speaks the saved settings' line, the shop's name in it, and calls nothing", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    const { defaults } = assistantProfile(null);
    expect(await saveAssistant(CTX, { ...defaults, name: "Asha", lang: "ta" }, null)).toEqual({ ok: true });
    expect(h.jar.has(MOCK_COOKIE)).toBe(true);
    const r = await testCall(CTX, "Acme Silks", null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.call.transcript[0].text).toContain("Asha");
      expect(r.call.transcript[0].text).toContain("Acme Silks");
    }
    expect(h.post).not.toHaveBeenCalled();
  });
  it("1: asks the API; second factor and a read-only workspace are named, anything else is 'not available'", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "1");
    h.post.mockResolvedValueOnce(call);
    expect(await testCall(CTX, "Acme", null)).toEqual({ ok: true, call });
    h.post.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await testCall(CTX, "Acme", null)).toEqual({ ok: false, error: "mfa" });
    h.post.mockRejectedValueOnce(new ApiRequestError(409, "workspace_read_only", "x"));
    expect(await testCall(CTX, "Acme", null)).toEqual({ ok: false, error: "read_only" });
    h.post.mockRejectedValueOnce(new Error("down"));
    expect(await testCall(CTX, "Acme", null)).toEqual({ ok: false, error: "not_available" });
  });
});

describe("postTestCall", () => {
  it("posts an empty body to the contract's path and refuses an answer that is not a fake call", async () => {
    h.req.mockResolvedValueOnce({ mode: "fake", note: "n", transcript: [{ speaker: "assistant", text: "Hi" }], outcome: null });
    const got = await (await vi.importActual<typeof import("@/lib/api/ai-assistant")>("@/lib/api/ai-assistant")).postTestCall("tok", CTX.tenantId);
    expect(got.transcript).toHaveLength(1);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${CTX.tenantId}/ai-assistant/test-call`, "tok", { method: "POST", body: "{}" });
    h.req.mockResolvedValueOnce({ mode: "live" });
    await expect((await vi.importActual<typeof import("@/lib/api/ai-assistant")>("@/lib/api/ai-assistant")).postTestCall("tok", CTX.tenantId)).rejects.toThrow();
  });
});
