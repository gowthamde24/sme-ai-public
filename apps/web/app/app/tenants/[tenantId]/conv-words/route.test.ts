import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { GET } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const get = (qs: string, id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => GET(new NextRequest(`http://x/app/tenants/${id}/conv-words?${qs}`, { headers }), { params: Promise.resolve({ tenantId: id }) });
beforeEach(() => {
  h.tenant.mockReset().mockResolvedValue({ role: "viewer" });
  h.user.mockReset().mockResolvedValue({ accessToken: "t" });
});

describe("GET conv-words (the words of one conversation part in one language)", () => {
  it("answers the talk words in Telugu: only the closed prefixes, plain dictionary text", async () => {
    const res = await get("lang=te&set=talk");
    expect(res.status).toBe(200);
    const { words } = (await res.json()) as { words: Record<string, string> };
    expect(words["dst.change"]).toBe("మార్చు");
    expect(Object.keys(words).every((k) => ["dst.", "tv6.talk.", "bv.chat.plan.", "bv.chat.state.", "bv.chat.err.", "bv.end.", "bv.live."].some((p) => k.startsWith(p)))).toBe(true);
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
  it("answers the task words (the typed plan card) in Hindi", async () => {
    const { words } = (await (await get("lang=hi&set=task")).json()) as { words: Record<string, string> };
    expect(words["tk.btn.pause"]).toBe("रोको");
    expect(Object.keys(words).every((k) => k.startsWith("tk.") || k.startsWith("pc."))).toBe(true);
  });
  it("refuses a language without a review sheet, a set that is not one of the two, a workspace id that is not a uuid and another site", async () => {
    expect((await get("lang=ta&set=talk")).status).toBe(404);
    expect((await get("lang=te&set=everything")).status).toBe(404);
    expect((await get("lang=te&set=talk", "x")).status).toBe(404);
    expect((await get("lang=te&set=talk", T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
  });
  it("a person who is not signed in is a 401; a workspace they are not in is a 404", async () => {
    h.user.mockRejectedValueOnce(new Error("redirect"));
    expect((await get("lang=te&set=talk")).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new ApiAuthError("x"));
    expect((await get("lang=te&set=talk")).status).toBe(401);
    h.tenant.mockRejectedValueOnce(new Error("404"));
    expect((await get("lang=te&set=talk")).status).toBe(404);
  });
});
