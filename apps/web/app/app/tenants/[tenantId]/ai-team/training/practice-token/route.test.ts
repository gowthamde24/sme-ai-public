import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

/** app v4 part 4: the sign-in for a practice call by voice (C1 #402): the Owner and an Admin only, same site only, APP_V4 and the training page only, never cached. */
const T = "22222222-2222-4222-8222-222222222222";
const post = (t = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${t}/ai-team/training/practice-token`, { method: "POST", headers }), { params: Promise.resolve({ tenantId: t }) });
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
  h.user.mockReset().mockResolvedValue({ accessToken: "the-token" });
  vi.unstubAllEnvs();
  vi.stubEnv("APP_V4", "1");
  vi.stubEnv("TALK_TRAINING_SCREENS", "1");
});

describe("POST practice-token", () => {
  it.each(["owner", "admin"])("hands it to the %s, never to be kept", async (role) => {
    h.tenant.mockResolvedValue({ role });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "the-token" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("refuses Sales and a Viewer, an id that is not a uuid, another site, and a server without app v4 or the training page, handing nothing over", async () => {
    for (const role of ["sales", "viewer"]) {
      h.tenant.mockResolvedValue({ role });
      expect((await post()).status).toBe(404);
    }
    h.tenant.mockResolvedValue({ role: "owner" });
    expect((await post("x")).status).toBe(404);
    expect((await post(T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    vi.stubEnv("TALK_TRAINING_SCREENS", "");
    expect((await post()).status).toBe(404);
    vi.stubEnv("TALK_TRAINING_SCREENS", "1");
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
