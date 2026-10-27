import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, unknown>(), createSource: vi.fn(), pullIndiaMart: vi.fn(), logs: [] as string[] }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (name: string, parse: (v: unknown) => unknown, fallback: unknown) => (h.jar.has(name) ? (parse(JSON.parse(JSON.stringify(h.jar.get(name)))) ?? fallback) : fallback),
  writeJar: async (name: string, value: unknown) => (JSON.stringify(value).length > 3500 ? false : (h.jar.set(name, value), true)),
}));
vi.mock("@/lib/api/lead-sources", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lead-sources")>()), createSource: (...a: unknown[]) => h.createSource(...a), pullIndiaMart: (...a: unknown[]) => h.pullIndiaMart(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { createSourceStep, discardStep, pullStep, readSources, rotateStep, statusStep } from "./source";
import type { SourceCreateBody } from "./types";

const ctx = { token: "t", tenantId: "22222222-2222-4222-8222-222222222222" };
const ID = "11111111-1111-4111-8111-111111111111";
const body = (kind: SourceCreateBody["kind"], over: Partial<SourceCreateBody> = {}): SourceCreateBody => ({ source_id: ID, kind, label: "Source", portal: null, consent: null, cost_per_lead_paise: null, ...over });
const T0 = new Date("2026-10-26T10:00:00Z");

beforeEach(() => {
  h.jar.clear();
  vi.clearAllMocks();
  process.env.LEADS_SCREENS = "mock";
});
afterEach(() => {
  delete process.env.LEADS_SCREENS;
});

describe("lead sources in test mode", () => {
  it("a website form: the secret (address and snippet) is in the answer once, and the cookie holds only the last four letters", async () => {
    const out = await createSourceStep(ctx, body("website_form", { cost_per_lead_paise: 1500 }), T0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const secret = out.data.secret;
    expect(secret?.shown_once).toBe(true);
    expect(secret?.url).toMatch(/^https:\/\/api\.example\.test\/v1\/lead-intake\/[A-Za-z0-9_-]{24}$/);
    expect(secret?.snippet_html).toContain("<form method=\"post\"");
    expect(secret?.snippet_html).toContain(secret?.url as string);
    const token = (secret?.url as string).split("/").pop() as string;
    const stored = JSON.stringify(h.jar.get("sme_leadsources_mock"));
    expect(stored).not.toContain(token);
    expect(out.data.token_hint).toBe(token.slice(-4));
    const read = await readSources(ctx, T0);
    expect(read.mode === "ok" && read.sources[0]).toMatchObject({ kind: "website_form", tag: "website_form", status: "active", cost_per_lead_paise: 1500, consent_confirmed: false, available: true });
    expect(JSON.stringify(read)).not.toContain(token);
  });
  it("the same source id again answers without the secret", async () => {
    await createSourceStep(ctx, body("webhook"), T0);
    const again = await createSourceStep(ctx, body("webhook"), T0);
    expect(again.ok && again.data.secret).toBeNull();
    const read = await readSources(ctx, T0);
    expect(read.mode === "ok" && read.sources).toHaveLength(1);
  });
  it("a forwarding address has an e-mail address and the portal's tag, and brings a mail nobody could read, which can be discarded", async () => {
    const out = await createSourceStep(ctx, body("email_forward", { portal: "justdial" }), T0);
    expect(out.ok && out.data.tag).toBe("justdial");
    expect(out.ok && out.data.secret?.email_address).toMatch(/^leads\+[A-Za-z0-9_-]{24}@inbound\.example\.test$/);
    const read = await readSources(ctx, T0);
    expect(read.mode === "ok" && read.unparsed).toHaveLength(1);
    const mailId = read.mode === "ok" ? read.unparsed[0].id : "";
    expect(await discardStep(ctx, mailId)).toEqual({ ok: true, data: null });
    const after = await readSources(ctx, T0);
    expect(after.mode === "ok" && after.unparsed).toEqual([]);
  });
  it("a forwarding address for 'any other' portal is tagged webhook", async () => {
    const out = await createSourceStep(ctx, body("email_forward"), T0);
    expect(out.ok && out.data.tag).toBe("webhook");
  });
  it("Meta Lead Ads has a callback and a verify token and is 'not switched on yet'; IndiaMART has no secret and can pull", async () => {
    const meta = await createSourceStep(ctx, body("meta_lead_ads", { source_id: "11111111-1111-4111-8111-111111111112" }), T0);
    expect(meta.ok && meta.data.available).toBe(false);
    expect(meta.ok && meta.data.secret?.meta_callback_url).toContain("/lead-intake/meta/");
    expect(meta.ok && meta.data.secret?.meta_verify_token).toBeTruthy();
    expect(await pullStep(ctx, T0)).toEqual({ ok: false, error: "connector_not_available" });
    const mart = await createSourceStep(ctx, body("indiamart", { source_id: "11111111-1111-4111-8111-111111111113" }), T0);
    expect(mart.ok && mart.data.secret).toBeNull();
    const pulled = await pullStep(ctx, T0);
    expect(pulled).toMatchObject({ ok: true, data: { fetched: 4, created: 3, merged: 1 } });
  });
  it("rotate gives a new secret and a new hint at once; pause and resume change the status", async () => {
    const made = await createSourceStep(ctx, body("webhook"), T0);
    const first = made.ok ? made.data : null;
    const rotated = await rotateStep(ctx, ID, T0);
    expect(rotated.ok && rotated.data.secret?.url).toBeTruthy();
    expect(rotated.ok && rotated.data.secret?.url).not.toBe(first?.secret?.url);
    expect(await statusStep(ctx, ID, "pause", T0)).toMatchObject({ ok: true, data: { status: "paused" } });
    expect(await statusStep(ctx, ID, "resume", T0)).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await rotateStep(ctx, "99999999-9999-4999-8999-999999999999", T0)).toEqual({ ok: false, error: "not_available" });
  });
  it("shows a made-up count of leads that grows with the clock, and none when paused", async () => {
    await createSourceStep(ctx, body("webhook"), T0);
    const later = new Date(T0.getTime() + 62 * 60_000);
    const read = await readSources(ctx, later);
    expect(read.mode === "ok" && read.sources[0].received_count).toBe(12);
    expect(read.mode === "ok" && read.sources[0].last_received_at).toBe(new Date(T0.getTime() + 60 * 60_000).toISOString());
    await statusStep(ctx, ID, "pause", later);
    const paused = await readSources(ctx, later);
    expect(paused.mode === "ok" && paused.sources[0].received_count).toBe(0);
  });
  it("keeps at most six sources", async () => {
    for (let i = 0; i < 6; i += 1) expect((await createSourceStep(ctx, body("webhook", { source_id: `11111111-1111-4111-8111-11111111111${i}`, label: `S${i}` }), T0)).ok).toBe(true);
    expect(await createSourceStep(ctx, body("webhook", { source_id: "11111111-1111-4111-8111-111111111119" }), T0)).toEqual({ ok: false, error: "too_many" });
  });
});

describe("lead sources through the API", () => {
  it("passes the secret of a create through to the caller and turns refusals into closed words", async () => {
    process.env.LEADS_SCREENS = "1";
    const made = { id: ID, secret: { shown_once: true, url: "https://api.example.test/v1/lead-intake/T" } };
    h.createSource.mockResolvedValueOnce(made);
    expect(await createSourceStep(ctx, body("webhook"))).toEqual({ ok: true, data: made });
    h.createSource.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await createSourceStep(ctx, body("webhook"))).toEqual({ ok: false, error: "mfa" });
    h.pullIndiaMart.mockRejectedValueOnce(new ApiRequestError(503, "connector_not_available", "x"));
    expect(await pullStep(ctx)).toEqual({ ok: false, error: "connector_not_available" });
  });
  it("off answers 'not available'", async () => {
    delete process.env.LEADS_SCREENS;
    expect(await readSources(ctx)).toEqual({ mode: "off" });
    expect(await createSourceStep(ctx, body("webhook"))).toEqual({ ok: false, error: "not_available" });
  });
});
