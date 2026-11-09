import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

/** app v4 part 4: the sign-in for the take-over socket's first message (C1 #398): the Owner and an Admin only, same site only, APP_V4 only, never cached. */
const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const post = (t = T, c = C, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${t}/calls/${c}/take-over-token`, { method: "POST", headers }), { params: Promise.resolve({ tenantId: t, callId: c }) });
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.user.mockReset().mockResolvedValue({ accessToken: "the-token" });
  vi.unstubAllEnvs();
  vi.stubEnv("APP_V4", "1");
});

describe("POST take-over-token", () => {
  it.each(["owner", "admin"])("hands it to the %s, never to be kept", async (role) => {
    h.tenant.mockResolvedValue({ role });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "the-token" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("refuses Sales and a Viewer, ids that are not uuids, another site, and a server without app v4, handing nothing over", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect((await post()).status).toBe(404);
    }
    h.tenant.mockResolvedValue({ role: "owner" });
    expect((await post("x")).status).toBe(404);
    expect((await post(T, "../x")).status).toBe(404);
    expect((await post(T, C, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    vi.stubEnv("APP_V4", "");
    expect((await post()).status).toBe(404);
  });
  it("not signed in is a 401; a lost session while reading the workspace is a 401; anything else a 404", async () => {
    h.user.mockRejectedValueOnce(new Error("redirect"));
    expect((await post()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiAuthError("out"));
    expect((await post()).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new Error("down"));
    expect((await post()).status).toBe(404);
  });
});
