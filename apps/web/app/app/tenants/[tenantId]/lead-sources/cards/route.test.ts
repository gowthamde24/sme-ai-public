import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void jar.delete(k) : void jar.set(k, v)) }) }));
const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));

import { ApiAuthError } from "@/lib/api/client";

import { POST } from "./route";

const T = "55555555-5555-4555-8555-555555555551";
const post = (body: unknown, id = T, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => POST(new NextRequest(`http://x/app/tenants/${id}/lead-sources/cards`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ tenantId: id }) });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: unknown; error?: string };
beforeEach(() => {
  jar.clear();
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
  it("lists the ten cards in the contract's order, each with a status and an action", async () => {
    const r = await json(await post({ op: "cards" }));
    const cards = r.data as { kind: string; status: string; action: string }[];
    expect(cards.map((c) => c.kind)).toEqual(["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets", "files", "whatsapp"]);
    expect(cards.find((c) => c.kind === "missed_calls")).toMatchObject({ status: "not_connected" });
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
    expect((await json(await post({ op: "website" }, id))).error).toBe("notconnected"); // nothing to show until the form is turned on
    await post({ op: "connect", card: "website" }, id);
    const site = (await json(await post({ op: "website" }, id))).data as { snippet: string; webhookUrl: string };
    expect(site.snippet).toContain("<form");
    expect(site.webhookUrl).toContain("/v1/lead-intake/");
    await post({ op: "rotate", card: "website" }, id);
    expect(((await json(await post({ op: "website" }, id))).data as { webhookUrl: string }).webhookUrl).not.toBe(site.webhookUrl);
    expect((await post({ op: "weird" }, id)).status).toBe(400);
  });
  it("Test needs the card connected, makes a marked lead and the card then shows its last lead; Disconnect turns it off again", async () => {
    const id = "55555555-5555-4555-8555-555555555553";
    expect(((await json(await post({ op: "test", card: "website" }, id))) as { error: string }).error).toBe("notconnected");
    await post({ op: "connect", card: "website" }, id);
    const done = (await json(await post({ op: "test", card: "website" }, id))) as { ok: boolean; data: { result: string } };
    expect(done.data.result).toBe("lead_created");
    const web = ((await json(await post({ op: "cards" }, id))).data as { kind: string; state: string; lastReceivedAt: string | null }[]).find((c) => c.kind === "website");
    expect(web).toMatchObject({ state: "connected" });
    expect(web?.lastReceivedAt).not.toBeNull();
    await post({ op: "disconnect", card: "website" }, id);
    expect(((await json(await post({ op: "cards" }, id))).data as { kind: string; state: string }[]).find((c) => c.kind === "website")?.state).toBe("off");
    expect((await post({ op: "test", card: "BAD card" }, id)).status).toBe(400);
  });
  it("a lead's cost is kept per lead tag and comes back on the card; a bad tag or amount is a 400", async () => {
    const id = "55555555-5555-4555-8555-555555555554";
    await post({ op: "connect", card: "website" }, id);
    expect((await post({ op: "cost", source: "website_form", paise: 4500 }, id)).status).toBe(200);
    const web = ((await json(await post({ op: "cards" }, id))).data as { kind: string; costPerLeadPaise: number | null; costSource: string }[]).find((c) => c.kind === "website");
    expect(web).toMatchObject({ costPerLeadPaise: 4500, costSource: "website_form" });
    expect((await post({ op: "cost", source: "Bad Tag", paise: 1 }, id)).status).toBe(400);
    expect((await post({ op: "cost", source: "website_form", paise: -5 }, id)).status).toBe(400);
    expect((await post({ op: "cost", source: "website_form", paise: 1.5 }, id)).status).toBe(400);
  });
  it("missed calls: connect answers the address once with its steps, Test and disconnect follow; the cards never carry the address", async () => {
    const id = "55555555-5555-4555-8555-555555555556";
    const got = (await json(await post({ op: "connect", card: "missed_calls" }, id))).data as { fields: { label: string; value: string }[]; steps: string[] };
    expect(got.fields[0].value).toContain("/v1/lead-intake/");
    expect(got.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify((await json(await post({ op: "cards" }, id))).data)).not.toContain(got.fields[0].value);
    expect(((await json(await post({ op: "test", card: "missed_calls" }, id))).data as { result: string }).result).toBe("lead_created");
    await post({ op: "disconnect", card: "missed_calls" }, id);
    expect(((await json(await post({ op: "cards" }, id))).data as { kind: string; state: string }[]).find((c) => c.kind === "missed_calls")?.state).toBe("off");
  });
});
