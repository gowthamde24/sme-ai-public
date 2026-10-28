import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const post = (id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${id}/voice-token`, { method: "POST", headers }), { params: Promise.resolve({ tenantId: id }) });
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.user.mockReset().mockResolvedValue({ accessToken: "the-token" });
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_VOICE", "1");
});

describe("POST voice-token (the socket's first message needs the sign-in)", () => {
  it.each(["owner", "admin", "sales"])("hands it to the %s of the workspace, never to be kept", async (role) => {
    h.tenant.mockResolvedValue({ role });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "the-token" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("refuses a viewer, a workspace id that is not a uuid, another site, and a server with the flag off, without handing anything over", async () => {
    h.tenant.mockResolvedValue({ role: "viewer" });
    expect((await post()).status).toBe(404);
    h.tenant.mockResolvedValue({ role: "owner" });
    expect((await post("x")).status).toBe(404);
    expect((await post(T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    vi.stubEnv("BROWSER_VOICE", "");
    expect((await post()).status).toBe(404);
  });
  it("a person who is not signed in, or a lost session, is a 401; a workspace that cannot be read is a 404", async () => {
    h.user.mockRejectedValueOnce(new Error("redirect"));
    expect((await post()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiAuthError("x"));
    expect((await post()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new Error("down"));
    expect((await post()).status).toBe(404);
  });
});
