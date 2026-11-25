// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { pubDict } from "@/i18n/public";
import pub from "@/i18n/strings/public.json";
import { resolveSite, allTargets } from "@/lib/site/routes";
import { sitePath } from "@/lib/site/paths";

import { articleBySlug, HELP_ARTICLES, TALK_TIMES, TALK_TYPES } from "./data";
import { readTalk, storeTalk } from "./demo";
import { overall, readHealth } from "./health";

describe("the help articles", () => {
  it("are ten, with unique slugs, and each has a title, a summary and three steps in the store", () => {
    expect(HELP_ARTICLES).toHaveLength(10);
    expect(new Set(HELP_ARTICLES.map((a) => a.slug)).size).toBe(10);
    for (const a of HELP_ARTICLES) for (const k of ["t", "d", "1", "2", "3"]) expect(Object.keys(pub), `${a.key}.${k}`).toContain(`pub.help.${a.key}.${k}`);
  });
  it("have addresses in every language, resolved back to the same article ('/help/x', '/te/help/x'); a wrong slug or language is a 404", () => {
    const slug = HELP_ARTICLES[0].slug;
    expect(sitePath("en", { kind: "article", slug })).toBe(`/help/${slug}`);
    expect(sitePath("te", { kind: "article", slug })).toBe(`/te/help/${slug}`);
    expect(resolveSite(["help", slug])).toEqual({ lang: "en", target: { kind: "article", slug } });
    expect(resolveSite(["kn", "help", slug])).toEqual({ lang: "kn", target: { kind: "article", slug } });
    for (const bad of [["help", "nope"], ["en", "help", slug], ["pricing", slug], ["te", "pricing", slug], ["help", slug, "x"]]) expect(resolveSite(bad), JSON.stringify(bad)).toBeNull();
    expect(allTargets().filter((t) => t.kind === "article")).toHaveLength(10);
    expect(articleBySlug(slug)?.key).toBe("setup");
  });
});

describe("the launch pages' words", () => {
  it("every Talk to us business type and time has a label", () => {
    for (const id of TALK_TYPES) expect(Object.keys(pub)).toContain(`pub.talk.t.${id}`);
    for (const id of TALK_TIMES) expect(Object.keys(pub)).toContain(`pub.talk.time.${id}`);
  });
  it("Telugu, Hindi and Kannada are drafts, in their own script, with English as the fallback in reviewed-only mode", () => {
    for (const [k, v] of Object.entries(pub)) expect((v as { status: Record<string, string> }).status, k).toEqual({ te: "draft", hi: "draft", kn: "draft" });
    expect(pubDict("te")["pub.price.title"]).toMatch(/[ఀ-౿]/);
  });
});

describe("Talk to us: what the server accepts", () => {
  const good = { name: " Asha  ", contact: "98480 12345", type: "clinic", time: "evening", what: "sarees", consent: true, lang: "te" };
  it("reads a good request, cleaning the text and the phone number", () => {
    expect(readTalk(good)).toEqual({ ok: true, value: { name: "Asha", phone: "9848012345", email: null, type: "clinic", time: "evening", what: "sarees", lang: "te" } });
    expect(readTalk({ ...good, contact: "Asha@Example.com" })).toMatchObject({ ok: true, value: { email: "asha@example.com", phone: null } });
  });
  it("refuses a missing name, a bad contact and no consent, in that order", () => {
    expect(readTalk({ ...good, name: "  " })).toEqual({ ok: false, error: "name" });
    expect(readTalk({ ...good, contact: "hello" })).toEqual({ ok: false, error: "contact" });
    expect(readTalk({ ...good, consent: "on" })).toEqual({ ok: false, error: "consent" });
    expect(readTalk(null)).toEqual({ ok: false, error: "name" });
  });
  it("an unknown type or time becomes 'other' and 'morning', never trusted", () => {
    expect(readTalk({ ...good, type: "<script>", time: "midnight" })).toMatchObject({ value: { type: "other", time: "morning" } });
  });
  it("stores nothing for now and says ok", async () => {
    const r = readTalk(good);
    if (!r.ok) throw new Error("x");
    expect(await storeTalk(r.value)).toEqual({ ok: true }); // mock or off: kept nowhere, as before
  });
});

describe("the status page's reading of /health", () => {
  const at = () => new Date("2026-11-25T10:00:00Z");
  it("up when the API answers status ok", async () => {
    const ask = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const h = await readHealth(at, ask);
    expect(h).toEqual({ api: "up", checkedAt: "2026-11-25T10:00:00.000Z" });
    expect((ask.mock.calls[0] as unknown as [string])[0]).toMatch(/\/health$/);
    expect(overall(h)).toBe("ok");
  });
  it("down on an error status, a wrong body or a failed request; never throws", async () => {
    expect((await readHealth(at, async () => new Response("", { status: 503 }))).api).toBe("down");
    expect((await readHealth(at, async () => new Response(JSON.stringify({ status: "bad" }), { status: 200 }))).api).toBe("down");
    expect((await readHealth(at, async () => { throw new Error("net"); })).api).toBe("down");
  });
});

describe("storeTalk posts to C1's contact route", async () => {
  const { vi } = await import("vitest");
  const client = await import("@/lib/api/client");
  const policy = await import("@/lib/api/policy");
  const value = { name: "Asha", phone: "+919876543210", email: null, type: "clinic" as const, time: "morning" as const, what: "", lang: "en" };
  const pub = (impl: (path: string, init?: { body?: unknown }) => Promise<unknown>) => {
    vi.spyOn(client, "apiPublicRequest").mockImplementation(impl as never);
    vi.spyOn(policy, "getCurrentPolicies").mockResolvedValue({ terms: "t1", privacy: "p1" });
  };
  const refuse = (status: number, code: string) => new client.ApiRequestError(status, code, "x");
  it("sends the body with both versions and consent, and shows the reference", async () => {
    let seen: unknown;
    pub(async (_p, init) => ((seen = init?.body), { status: "received", reference: "TQ-1A2B3C4D" }));
    expect(await storeTalk(value, "on")).toEqual({ ok: true, reference: "TQ-1A2B3C4D" });
    expect(seen).toEqual({ name: "Asha", phone: "+919876543210", business_kind: "clinic", good_time: "morning", consent: true, terms_version: "t1", notice_version: "p1", captcha_token: null });
  });
  it("a duplicate shows the same thanks; a reference of the wrong shape is left out", async () => {
    pub(async () => ({ status: "duplicate", reference: "TQ-ABCD1234" }));
    expect(await storeTalk(value, "on")).toEqual({ ok: true, reference: "TQ-ABCD1234" });
    pub(async () => ({ status: "received", reference: "<script>" }));
    expect(await storeTalk(value, "on")).toEqual({ ok: true });
  });
  it("an outdated version is read again and sent once more", async () => {
    let n = 0;
    pub(async () => {
      if (++n === 1) throw refuse(409, "policy_version_outdated");
      return { status: "received", reference: "TQ-ABCD1234" };
    });
    expect(await storeTalk(value, "on")).toEqual({ ok: true, reference: "TQ-ABCD1234" });
    expect(n).toBe(2);
  });
  it("every refusal is one plain word", async () => {
    for (const [status, code, word] of [[429, "rate_limited", "rate"], [400, "captcha_failed", "check"], [422, "validation_error", "invalid"], [503, "busy", "busy"], [500, "x", "down"], [404, "not_found", "down"]] as const) {
      pub(async () => {
        throw refuse(status, code);
      });
      expect(await storeTalk(value, "on"), code).toEqual({ ok: false, error: word });
    }
  });
});
