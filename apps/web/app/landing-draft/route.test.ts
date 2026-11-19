// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isNotFound, notFoundMock } from "@/test/helpers";

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

import { GET } from "./route";

const ask = (query = "", nonce = "abc123+/=") => new NextRequest(`http://localhost/landing-draft${query}`, { headers: { "x-nonce": nonce } });

beforeEach(() => vi.stubEnv("LANDING_DRAFT", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("/landing-draft: a DRAFT, only where LANDING_DRAFT is on", () => {
  it.each([[""], ["0"], ["true"]])("flag %j: a plain 404", async (value) => {
    vi.stubEnv("LANDING_DRAFT", value);
    expect(await isNotFound(async () => GET(ask()))).toBe(true);
  });

  it("unset: a plain 404", async () => {
    vi.unstubAllEnvs();
    delete process.env.LANDING_DRAFT;
    expect(await isNotFound(async () => GET(ask()))).toBe(true);
  });

  it("on: one HTML document under the Draft bar, never indexed, no placeholder left", async () => {
    const res = await GET(ask());
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Draft: not live");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/__[A-Z_]+__/);
    expect(html).toContain("Pay as you go");
    expect(html).toContain("1,999");
  });

  it("carries the request's nonce on every inline script and style (and no bare one)", async () => {
    const html = await (await GET(ask("", "n0nce+/="))).text();
    expect(html.match(/<script\s*>|<style\s*>/gi)).toBeNull();
    for (const tag of html.match(/<(script|style)[\s>]/gi) ?? []) expect(tag).toMatch(/<(script|style)\s/i);
    expect([...html.matchAll(/<(?:script|style)\s+nonce="([^"]*)"/gi)].map((m) => m[1])).toEqual(["n0nce+/=", "n0nce+/=", "n0nce+/="]);
  });

  it("a nonce with odd characters cannot break out of the attribute", async () => {
    const html = await (await GET(ask("", 'x"><img src=x onerror=alert(1)>'))).text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('nonce="x"');
  });

  it("says nothing the owner has retired: no Lead Desk, no unlimited", async () => {
    const html = await (await GET(ask())).text();
    expect(html).not.toMatch(/lead desk|unlimited/i);
  });

  it("share picture: English by default, Telugu with ?lang=te; the brand is the constant", async () => {
    const en = await (await GET(ask())).text();
    const te = await (await GET(ask("?lang=te"))).text();
    expect(en).toContain('property="og:image" content="https://stack19.com/og/landing-en.png"');
    expect(te).toContain('property="og:image" content="https://stack19.com/og/landing-te.png"');
    expect(en).toContain('property="og:site_name" content="Stack19"');
  });

  it("'Join early access' leads where the live pages' early-access button leads", async () => {
    const html = await (await GET(ask())).text();
    const hrefs = new Set([...html.matchAll(/<a class="btn[^"]*" href="([^"]*)"/g)].map((m) => m[1]));
    expect([...hrefs]).toHaveLength(1);
    expect([...hrefs][0]).toMatch(/^\/(signup|contact#demo|#demo)$/);
  });
});
