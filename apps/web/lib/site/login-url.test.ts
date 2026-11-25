import { afterEach, describe, expect, it, vi } from "vitest";

import { loginHref, PUBLIC_APP_ORIGIN } from "./login-url";

afterEach(() => vi.unstubAllEnvs());

describe("where 'Log in' leads", () => {
  it("is /login on the same address in the usual mode, whatever SITE_APP_ORIGIN says", () => {
    expect(loginHref(false, "https://staging.stack19.com")).toBe("/login");
    expect(loginHref(false, undefined)).toBe("/login");
  });
  it("is the app's address when SITE_APP_ORIGIN is not set: app.stack19.com", () => {
    expect(PUBLIC_APP_ORIGIN).toBe("https://app.stack19.com");
    expect(loginHref(true, undefined)).toBe("https://app.stack19.com/login");
    expect(loginHref(true, "")).toBe("https://app.stack19.com/login");
  });
  it("is SITE_APP_ORIGIN when it is set (a trailing slash or path is dropped)", () => {
    expect(loginHref(true, "https://app.example.test")).toBe("https://app.example.test/login");
    expect(loginHref(true, "https://app.example.test/")).toBe("https://app.example.test/login");
    expect(loginHref(true, " https://app.example.test/x/y ")).toBe("https://app.example.test/login");
    expect(loginHref(true, "http://localhost:3000")).toBe("http://localhost:3000/login");
  });
  it("falls back to the app's address when the value is not a web address", () => {
    for (const bad of ["not a url", "javascript:alert(1)", "ftp://x.test", "//x.test", "app.stack19.com"]) expect(loginHref(true, bad), bad).toBe("https://app.stack19.com/login");
  });
  it("reads the variable when it is asked (at request time), not when the file is loaded, and never NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv("SITE_MODE", "website");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.stack19.com");
    expect(loginHref()).toBe("https://app.stack19.com/login");
    vi.stubEnv("SITE_APP_ORIGIN", "https://app2.example.test/");
    expect(loginHref()).toBe("https://app2.example.test/login");
    vi.stubEnv("SITE_MODE", "app");
    expect(loginHref()).toBe("/login");
  });
});
