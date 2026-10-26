import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), sample: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/voice-samples", () => ({ getVoiceSample: (...a: unknown[]) => h.sample(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { GET } from "./route";

const T = "22222222-2222-2222-2222-222222222222";
const get = (qs = "voice=female_warm&lang=ta&tone=warm&name=Asha", id = T) => GET(new NextRequest(`http://x/app/tenants/${id}/voice-sample?${qs}`), { params: Promise.resolve({ tenantId: id }) });

beforeEach(() => {
  vi.unstubAllEnvs();
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.sample.mockReset();
});

describe("GET voice-sample (job DQ part 3)", () => {
  it("is not there while the screens are off", async () => {
    expect((await get()).status).toBe(404);
    expect(h.user).not.toHaveBeenCalled();
  });
  it("mock: a private, nosniff WAV, and a bad query or workspace id is a 404", async () => {
    vi.stubEnv("VOICE_SAMPLE_SCREENS", "mock");
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("audio/wav");
    expect(r.headers.get("Cache-Control")).toContain("private");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await get("voice=own_voice&lang=en&tone=warm")).status).toBe(404);
    expect((await get("voice=female_warm&lang=en&tone=warm", "not-a-uuid")).status).toBe(404);
  });
  it("only the Owner and an Admin may hear it; a signed-out person gets 401; an expired token gets 401", async () => {
    vi.stubEnv("VOICE_SAMPLE_SCREENS", "mock");
    h.tenant.mockResolvedValueOnce({ role: "member" });
    expect((await get()).status).toBe(404);
    h.tenant.mockResolvedValueOnce({ role: "admin" });
    expect((await get()).status).toBe(200);
    h.user.mockRejectedValueOnce(new Error("no session"));
    expect((await get()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    expect((await get()).status).toBe(401);
  });
  it("1: hands on the API's sound with its type only; none is 404, a failing API is 502", async () => {
    vi.stubEnv("VOICE_SAMPLE_SCREENS", "1");
    h.sample.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]).buffer, contentType: "audio/mpeg; charset=x" });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(h.sample).toHaveBeenCalledWith("tok", T, { voice: "female_warm", lang: "ta", tone: "warm", name: "Asha" });
    h.sample.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    h.sample.mockRejectedValueOnce(new Error("down"));
    expect((await get()).status).toBe(502);
    h.sample.mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30));
    const limited = await get();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
  });
});
