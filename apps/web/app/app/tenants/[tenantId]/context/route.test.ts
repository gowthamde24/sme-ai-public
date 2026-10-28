import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void jar.delete(k) : void jar.set(k, v)) }) }));
const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown, id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${id}/context`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: id }) });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string };
beforeEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
  vi.stubEnv("ABOUT_BUSINESS_SCREENS", "mock");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
});

describe("POST context (About my business)", () => {
  it("is not there with the flag off, from another site, or for a workspace id that is not a uuid", async () => {
    vi.stubEnv("ABOUT_BUSINESS_SCREENS", "");
    expect((await post({ op: "get" })).status).toBe(404);
    vi.stubEnv("ABOUT_BUSINESS_SCREENS", "mock");
    expect((await post({ op: "get" }, T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    expect((await post({ op: "get" }, "x")).status).toBe(404);
  });
  it("saves with the version it started from, refuses a stale one with a closed word, and keeps versions", async () => {
    const id = "44444444-4444-4444-8444-444444444441";
    expect((await json(await post({ op: "get" }, id))).data).toMatchObject({ notes: "", version: 0 });
    expect((await json(await post({ op: "put", notes: "We deliver in the city.", version: 0 }, id))).data).toMatchObject({ version: 1 });
    expect(await json(await post({ op: "put", notes: "other", version: 0 }, id))).toEqual({ ok: false, error: "changed" });
    const v = await json(await post({ op: "versions" }, id));
    expect(v.data).toEqual([expect.objectContaining({ version: 1 })]);
  });
  it("a preview saves nothing; saving it needs the person's own (edited) text and a mode", async () => {
    const id = "44444444-4444-4444-8444-444444444442";
    const p = await json(await post({ op: "understand", kind: "paste", text: "Paver blocks: 38 rupees" }, id));
    expect(p.ok).toBe(true);
    expect((await json(await post({ op: "get" }, id))).data).toMatchObject({ version: 0 });
    const previewId = String(p.data?.previewId);
    expect((await post({ op: "save", previewId, notes: "edited", mode: "sideways", version: 0 }, id)).status).toBe(400);
    expect((await json(await post({ op: "save", previewId, notes: "edited", mode: "append", version: 0 }, id))).data).toMatchObject({ notes: "edited", version: 1 });
  });
  it("answers 'Try it' as the assistant would", async () => {
    const id = "44444444-4444-4444-8444-444444444443";
    expect((await json(await post({ op: "test", question: "what is the price?" }, id))).data).toMatchObject({ wouldHandOver: true, reason: "asked_about_money" });
    expect((await post({ op: "test", question: "   " }, id)).status).toBe(400);
  });
  it("refuses a file that is not base64, a missing text, a bad kind and an op it does not know (400)", async () => {
    for (const bad of [{ op: "understand", kind: "file", filename: "a.pdf", contentBase64: "not base64!" }, { op: "understand", kind: "paste" }, { op: "understand", kind: "video", text: "x" }, { op: "weird" }, { op: "put", notes: "x" }, { op: "version" }]) expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
  });
  it("lets a Sales or Viewer member read but not write; sends the person to sign in when the session lapsed", async () => {
    h.tenant.mockResolvedValue({ role: "sales" });
    expect((await json(await post({ op: "get" }))).ok).toBe(true);
    expect(await json(await post({ op: "put", notes: "x", version: 0 }))).toEqual({ ok: false, error: "forbidden" });
    expect(await json(await post({ op: "test", question: "hi" }))).toEqual({ ok: false, error: "forbidden" });
    h.tenant.mockRejectedValue(new ApiAuthError("x"));
    expect((await post({ op: "get" })).status).toBe(401);
    h.user.mockRejectedValue(new Error("no session"));
    expect((await post({ op: "get" })).status).toBe(401);
  });
});
