import { describe, expect, it } from "vitest";

import { buildCsp, newNonce } from "./csp";
import { securityHeaders } from "./headers";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d === name || d.startsWith(name + " ")) ?? "";

describe("buildCsp", () => {
  const prod = buildCsp("NONCE123", false);
  const dev = buildCsp("NONCE123", true);

  it("allows scripts only by nonce (and what a nonced script loads), never inline", () => {
    for (const csp of [prod, dev]) {
      const script = directive(csp, "script-src");
      expect(script).toContain("'nonce-NONCE123'");
      expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toMatch(/https?:|\*/);
    }
  });

  it("allows eval only in development", () => {
    expect(directive(prod, "script-src")).not.toContain("unsafe-eval");
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("allows inline style ATTRIBUTES only, style elements need the nonce", () => {
    expect(directive(prod, "style-src")).toBe("style-src 'self' 'nonce-NONCE123'");
    expect(directive(prod, "style-src")).not.toContain("unsafe-inline");
    expect(directive(dev, "style-src")).toContain("'unsafe-inline'"); // hot reload only
    expect(directive(prod, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
  });

  it("forbids framing, plugins, base-tag tricks and foreign form targets", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"])
      expect(directive(prod, d.split(" ")[0])).toBe(d);
  });

  it("lets the browser talk to this app only (the API and Supabase are called from the server)", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
    expect(prod).not.toMatch(/https?:\/\//);
  });

  it("upgrades insecure requests in production only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("allows the authenticator QR code (a data URI image) and nothing remote", () => {
    expect(directive(prod, "img-src")).toBe("img-src 'self' blob: data:");
  });
});

describe("newNonce", () => {
  it("is unpredictable: 128 bits, different every time, base64", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("securityHeaders", () => {
  const names = (production: boolean) => Object.fromEntries(securityHeaders(production).map((h) => [h.key, h.value]));

  it("always sets the basic set", () => {
    const h = names(false);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });

  it("sends HSTS in production only, for two years including subdomains", () => {
    expect(names(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(names(true)["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("leaves the Content-Security-Policy to the proxy (it carries a nonce)", () => {
    expect(names(true)["Content-Security-Policy"]).toBeUndefined();
  });
});
