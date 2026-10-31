import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const T = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ user: null as null | { accessToken: string }, patch: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("NEXT_REDIRECT:/login");
    return h.user;
  },
}));
vi.mock("@/lib/api/me", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/me")>()), patchMyProfile: (...a: unknown[]) => h.patch(...a) }));

import { POST } from "./route";

const HOST = "app.example.test";
const post = (body: unknown, headers: Record<string, string> = { origin: `https://${HOST}`, host: HOST }, tenant = T) =>
  POST(new NextRequest(`https://${HOST}/app/tenants/${tenant}/chat-language`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ tenantId: tenant }) });

beforeEach(() => {
  h.user = { accessToken: "person-token" };
  h.patch.mockReset();
  h.patch.mockResolvedValue({});
});

describe("POST /app/tenants/[id]/chat-language", () => {
  it("saves the pill's choice on the person's own profile with their token, and only that field", async () => {
    for (const language of ["auto", "te", "ml"]) {
      const r = await post({ language });
      expect(r.status).toBe(204);
      expect(h.patch).toHaveBeenLastCalledWith("person-token", T, { preferred_chat_language: language });
    }
  });
  it("refuses a language the API does not know, a bad body, another site, a bad workspace id and a missing session", async () => {
    expect((await post({ language: "klingon" })).status).toBe(422);
    expect((await post({ language: null })).status).toBe(422);
    expect((await post("not json")).status).toBe(422);
    expect((await post({ language: "te" }, { origin: "https://evil.example", host: HOST })).status).toBe(403);
    expect((await post({ language: "te" }, undefined, "nope")).status).toBe(404);
    h.user = null;
    expect((await post({ language: "te" })).status).toBe(401);
    expect(h.patch).not.toHaveBeenCalled();
  });
  it("passes on a rejected session (401), a refusal of the value (422) and an API that is down (503)", async () => {
    h.patch.mockRejectedValueOnce(new ApiAuthError());
    expect((await post({ language: "te" })).status).toBe(401);
    h.patch.mockRejectedValueOnce(new ApiRequestError(422, "invalid", "x"));
    expect((await post({ language: "te" })).status).toBe(422);
    h.patch.mockRejectedValueOnce(new Error("down"));
    expect((await post({ language: "te" })).status).toBe(503);
  });
});
