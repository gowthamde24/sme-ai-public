import { afterEach, describe, expect, it, vi } from "vitest";

import { hardenCookieOptions } from "./cookies";

afterEach(() => vi.unstubAllEnvs());

describe("the session cookie (job CE: web at app.<domain>, API at api.<domain>)", () => {
  it("is HttpOnly, SameSite=Lax, path / and Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hardenCookieOptions({ maxAge: 400 * 24 * 3600 })).toEqual({ maxAge: 400 * 24 * 3600, path: "/", httpOnly: true, sameSite: "lax", secure: true });
  });

  it("is not Secure on http://localhost in development (the browser would not store it)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(hardenCookieOptions({}).secure).toBe(false);
  });

  it("is HOST-ONLY: a Domain attribute is dropped, so the cookie never goes to api.<domain> or a sibling subdomain", () => {
    vi.stubEnv("NODE_ENV", "production");
    const out = hardenCookieOptions({ domain: ".example.com", maxAge: 60 });
    expect("domain" in out).toBe(false);
    expect(out).toMatchObject({ maxAge: 60, httpOnly: true, secure: true });
  });

  it("cannot be loosened by what the caller passes", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hardenCookieOptions({ httpOnly: false, sameSite: "none", secure: false, path: "/app" })).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  });
});
