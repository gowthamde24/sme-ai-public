import { describe, expect, it, vi } from "vitest";

import { buildCsp } from "./csp";
import { passesTurnstile, turnstileSiteKey } from "./turnstile";

const ON = "0x4AAA-site";

describe("Turnstile on the public forms", () => {
  it("is on when the (public) site key is set; the web holds no secret", () => {
    expect(turnstileSiteKey(undefined)).toBeNull();
    expect(turnstileSiteKey(" ")).toBeNull();
    expect(turnstileSiteKey(ON)).toBe("0x4AAA-site");
  });
  it("lets every form through when it is off (nobody is asked anything)", async () => {
    const verify = vi.fn(async () => false);
    expect(await passesTurnstile(undefined, null, undefined, verify)).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
  it("hands a token of the right shape and the address to the check, and passes only what it passes", async () => {
    const verify = vi.fn(async () => true);
    expect(await passesTurnstile("a-good-token-123", "203.0.113.7", ON, verify)).toBe(true);
    expect(verify).toHaveBeenCalledWith("a-good-token-123", "203.0.113.7");
    expect(await passesTurnstile("a-used-token-123", null, ON, async () => false)).toBe(false);
  });
  it("fails closed: no token, a token of the wrong shape, all mean 'not checked' without asking", async () => {
    const verify = vi.fn(async () => true);
    for (const t of [undefined, null, "", "short", 5, "x".repeat(3000)]) expect(await passesTurnstile(t, null, ON, verify)).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
  it("the page policy allows Cloudflare's frame only when the check is on", () => {
    expect(buildCsp("n", false)).not.toContain("challenges.cloudflare.com");
    expect(buildCsp("n", false, null, true)).toContain("frame-src https://challenges.cloudflare.com");
    expect(buildCsp("n", false, null, true)).toContain("frame-ancestors 'none'");
    expect(buildCsp("n", false, null, true)).toContain("'strict-dynamic'");
  });
});
