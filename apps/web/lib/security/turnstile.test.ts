import { describe, expect, it, vi } from "vitest";

import { buildCsp } from "./csp";
import { passesTurnstile, turnstileSiteKey } from "./turnstile";

const ON = { TURNSTILE_SITE_KEY: "0x4AAA-site", TURNSTILE_SECRET: "0x4AAA-secret" };
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Turnstile on the public forms", () => {
  it("is on only when both keys are set; the site key is the only one ever given out", () => {
    expect(turnstileSiteKey({})).toBeNull();
    expect(turnstileSiteKey({ TURNSTILE_SITE_KEY: "s" })).toBeNull();
    expect(turnstileSiteKey({ TURNSTILE_SECRET: "x" })).toBeNull();
    expect(turnstileSiteKey({ TURNSTILE_SITE_KEY: " ", TURNSTILE_SECRET: "x" })).toBeNull();
    expect(turnstileSiteKey(ON)).toBe("0x4AAA-site");
  });
  it("lets every form through when it is off (nothing is asked of Cloudflare)", async () => {
    const f = answer({ success: false });
    expect(await passesTurnstile(undefined, null, {}, f)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it("asks Cloudflare with the secret, the token and the address, and passes only a success", async () => {
    const f = answer({ success: true });
    expect(await passesTurnstile("a-good-token-123", "203.0.113.7", ON, f)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toContain("secret=0x4AAA-secret");
    expect(String(init.body)).toContain("response=a-good-token-123");
    expect(String(init.body)).toContain("remoteip=203.0.113.7");
    expect(await passesTurnstile("a-used-token-123", null, ON, answer({ success: false, "error-codes": ["timeout-or-duplicate"] }))).toBe(false);
  });
  it("fails closed: no token, a token of the wrong shape, a refusal, an odd answer or an unreachable check all mean 'not checked'", async () => {
    const never = answer({ success: true });
    for (const t of [undefined, null, "", "short", 5, "x".repeat(3000)]) expect(await passesTurnstile(t, null, ON, never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
    expect(await passesTurnstile("a-good-token-123", null, ON, answer({ success: true }, 500))).toBe(false);
    expect(await passesTurnstile("a-good-token-123", null, ON, answer("yes"))).toBe(false);
    expect(await passesTurnstile("a-good-token-123", null, ON, answer({ success: "true" }))).toBe(false);
    expect(await passesTurnstile("a-good-token-123", null, ON, vi.fn(async () => Promise.reject(new Error("down"))))).toBe(false);
  });
  it("the page policy allows Cloudflare's frame only when the check is on", () => {
    expect(buildCsp("n", false)).not.toContain("challenges.cloudflare.com");
    expect(buildCsp("n", false, null, true)).toContain("frame-src https://challenges.cloudflare.com");
    expect(buildCsp("n", false, null, true)).toContain("frame-ancestors 'none'");
    expect(buildCsp("n", false, null, true)).toContain("'strict-dynamic'");
  });
});
