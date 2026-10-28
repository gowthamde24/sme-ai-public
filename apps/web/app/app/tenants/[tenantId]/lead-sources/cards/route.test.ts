import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

const T = "55555555-5555-4555-8555-555555555551";
const post = (body: unknown, id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${id}/lead-sources/cards`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: id }) });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: unknown; error?: string };
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SOURCE_CARDS_SCREENS", "mock");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner" });
});

describe("POST lead-sources/cards", () => {
  it("is not there with the flag off, from another site, for a bad workspace id, or for anyone but the Owner and Admins", async () => {
    vi.stubEnv("SOURCE_CARDS_SCREENS", "");
    expect((await post({ op: "cards" })).status).toBe(404);
    vi.stubEnv("SOURCE_CARDS_SCREENS", "mock");
    expect((await post({ op: "cards" }, T, { "sec-fetch-site": "cross-site" })).status).toBe(404);
    expect((await post({ op: "cards" }, "x")).status).toBe(404);
    h.tenant.mockResolvedValue({ role: "sales" });
    expect((await post({ op: "cards" })).status).toBe(404);
    h.tenant.mockRejectedValue(new ApiAuthError("x"));
    expect((await post({ op: "cards" })).status).toBe(401);
  });
  it("lists the seven cards in the contract's order, each with a status and an action", async () => {
    const r = await json(await post({ op: "cards" }));
    const cards = r.data as { kind: string; status: string; action: string }[];
    expect(cards.map((c) => c.kind)).toEqual(["meta", "indiamart", "email_forward", "website", "files", "whatsapp", "missed_calls"]);
    expect(cards.find((c) => c.kind === "missed_calls")).toMatchObject({ status: "coming_soon" });
  });
  it("an IndiaMART key turns the card connected and is never given back, only a hint; a short key is refused in plain words; disconnect turns it off", async () => {
    const id = "55555555-5555-4555-8555-555555555552";
    const saved = await json(await post({ op: "indiamart_key", key: "abcd1234wxyz" }, id));
    expect(saved).toEqual({ ok: true, data: { status: "connected", hint: "...wxyz" } });
    expect(JSON.stringify(saved)).not.toContain("abcd1234");
    const state = async () => ((await json(await post({ op: "cards" }, id))).data as { kind: string; status: string }[]).find((c) => c.kind === "indiamart")?.status;
    expect(await state()).toBe("connected");
    expect(await json(await post({ op: "indiamart_key", key: "short1" }, id))).toEqual({ ok: false, error: "badkey" });
    await post({ op: "indiamart_disconnect" }, id);
    expect(await state()).toBe("not_connected");
    expect((await post({ op: "indiamart_key", key: "x" }, id)).status).toBe(400);
  });
  it("Facebook: the address to open is a secure one, a Page is chosen by id, and a bad id is a 400", async () => {
    const id = "55555555-5555-4555-8555-555555555553";
    expect((await json(await post({ op: "meta_connect" }, id))).data).toMatch(/^https:\/\//);
    await post({ op: "meta_select", pageId: "p1" }, id);
    expect(((await json(await post({ op: "meta_pages" }, id))).data as { selected: boolean }[])[0].selected).toBe(true);
    expect((await post({ op: "meta_select", pageId: "../x" }, id)).status).toBe(400);
  });
  it("the forwarding address can be made new; the website gives a snippet; an unknown op is a 400", async () => {
    const id = "55555555-5555-4555-8555-555555555554";
    const a = (await json(await post({ op: "email" }, id))).data as { address: string };
    const b = (await json(await post({ op: "email", rotate: true }, id))).data as { address: string };
    expect(b.address).not.toBe(a.address);
    expect(((await json(await post({ op: "website" }, id))).data as { snippet: string }).snippet).toContain("src=");
    expect((await post({ op: "weird" }, id)).status).toBe(400);
  });
});
