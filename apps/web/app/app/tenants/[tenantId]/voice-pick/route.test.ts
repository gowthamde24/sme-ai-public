import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), read: vi.fn(), file: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/voice-picker/source", () => ({ readVoicePicker: (...a: unknown[]) => h.read(...a) }));
vi.mock("@/lib/api/voice-picker", () => ({ getVoiceSampleFile: (...a: unknown[]) => h.file(...a) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { GET } from "./route";

const T = "22222222-2222-2222-2222-222222222222";
const get = (qs = "id=cartesia_hi_sanya", id = T) => GET(new NextRequest(`http://x/app/tenants/${id}/voice-pick?${qs}`), { params: Promise.resolve({ tenantId: id }) });
const picker = (fake: boolean, sampleUrl: string | null = "/static/hi.mp3") => ({ mode: "ok", data: { fake, choices: {}, voices: [{ id: "cartesia_hi_sanya", sampleUrl }, { id: "cartesia_hi_esha", sampleUrl: null }] } });

beforeEach(() => {
  vi.unstubAllEnvs();
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.read.mockReset();
  h.file.mockReset();
});

describe("GET voice-pick (the recorded sample of one voice)", () => {
  it("is not there while the screens are off, and a bad id or workspace is a 404 before anything is read", async () => {
    expect((await get()).status).toBe(404);
    vi.stubEnv("VOICE_PICKER_SCREENS", "mock");
    expect((await get("id=../x")).status).toBe(404);
    expect((await get("id=cartesia_hi_sanya", "not-a-uuid")).status).toBe(404);
    expect(h.user).not.toHaveBeenCalled();
  });
  it("mock: a kept-for-a-day, nosniff WAV for a voice of the catalogue; a voice that is not listed, or has no sample, is 404", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "mock");
    h.read.mockResolvedValue(picker(true));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("audio/wav");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await get("id=cartesia_hi_esha")).status).toBe(404);
    expect((await get("id=nobody")).status).toBe(404);
  });
  it("only the Owner and an Admin may hear it; signed out is 401, an expired token 401", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "mock");
    h.read.mockResolvedValue(picker(true));
    h.tenant.mockResolvedValueOnce({ role: "sales" });
    expect((await get()).status).toBe(404);
    h.tenant.mockResolvedValueOnce({ role: "admin" });
    expect((await get()).status).toBe(200);
    h.user.mockRejectedValueOnce(new Error("no session"));
    expect((await get()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiAuthError());
    expect((await get()).status).toBe(401);
  });
  it("1: hands on the file the catalogue names with its type only; not audio is 404; a failing API is 502", async () => {
    vi.stubEnv("VOICE_PICKER_SCREENS", "1");
    h.read.mockResolvedValue(picker(false));
    h.file.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]).buffer, contentType: "audio/mpeg; charset=x" });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(h.file).toHaveBeenCalledWith("tok", "/static/hi.mp3");
    h.file.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "text/html" });
    expect((await get()).status).toBe(404);
    h.file.mockRejectedValueOnce(new Error("down"));
    expect((await get()).status).toBe(502);
    h.file.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect((await get()).status).toBe(404);
  });
});
