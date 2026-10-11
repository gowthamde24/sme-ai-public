import { describe, expect, it } from "vitest";

import { fromThisSite } from "./same-site";

const req = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n.toLowerCase()] ?? null } });

describe("a request from this site only", () => {
  it("is from this site when the browser says same-origin, or the Origin names this host", () => {
    expect(fromThisSite(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(fromThisSite(req({ origin: "https://app.example", host: "app.example" }))).toBe(true);
    expect(fromThisSite(req({ origin: "http://localhost:3002", host: "localhost:3002" }))).toBe(true);
  });
  it("is not when it comes from another site, another port, a sibling domain, or says nothing", () => {
    expect(fromThisSite(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(fromThisSite(req({ "sec-fetch-site": "same-site", origin: "https://other.app.example", host: "app.example" }))).toBe(false);
    expect(fromThisSite(req({ origin: "http://localhost:3000", host: "localhost:3002" }))).toBe(false);
    expect(fromThisSite(req({ origin: "https://app.example.evil.test", host: "app.example" }))).toBe(false);
    expect(fromThisSite(req({ host: "app.example" }))).toBe(false);
    expect(fromThisSite(req({}))).toBe(false);
    expect(fromThisSite(req({ origin: "not a url", host: "app.example" }))).toBe(false);
  });
});
