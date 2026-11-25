import { describe, expect, it } from "vitest";

import { loginHref, PUBLIC_APP_ORIGIN } from "./login-url";

describe("where 'Log in' leads", () => {
  it("is /login on the same address in the usual mode", () => {
    expect(loginHref(false, "https://staging.stack19.com")).toBe("/login");
  });
  it("is the app's own address on the public site (stack19.com, www): app.stack19.com", () => {
    expect(PUBLIC_APP_ORIGIN).toBe("https://app.stack19.com");
    for (const u of ["https://stack19.com", "https://www.stack19.com/", "https://stack19.com:443"]) expect(loginHref(true, u), u).toBe("https://app.stack19.com/login");
  });
  it("is the deployment's own address anywhere else (staging, a preview, local), never production's", () => {
    expect(loginHref(true, "https://staging.stack19.com")).toBe("https://staging.stack19.com/login");
    expect(loginHref(true, "https://web-abc-uc.a.run.app/")).toBe("https://web-abc-uc.a.run.app/login");
    expect(loginHref(true, "http://localhost:3000")).toBe("http://localhost:3000/login");
  });
  it("falls back to the app's address when the setting is not an address", () => {
    expect(loginHref(true, "not a url")).toBe("https://app.stack19.com/login");
  });
});
