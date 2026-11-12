import { afterEach, describe, expect, it, vi } from "vitest";

import { apiPublicRequest } from "@/lib/api/client";
import { waitlistApiBase } from "./api-base";
import { waitlistMode } from "./mode";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("waitlistApiBase: the production API the live website posts to", () => {
  it("accepts an https address and drops a trailing slash", () => {
    expect(waitlistApiBase("https://sme-api-abc123-el.a.run.app/")).toBe("https://sme-api-abc123-el.a.run.app");
    expect(waitlistApiBase("https://api.stack19.com")).toBe("https://api.stack19.com");
  });
  it.each([
    undefined,
    "",
    "   ",
    "not a url",
    "http://api.stack19.com",
    "https://localhost:8000",
    "https://staging-api.stack19.com",
    "https://api.staging.stack19.com",
    "https://user:pw@api.stack19.com",
    "https://api.stack19.com/?x=1",
    "https://api.stack19.com/#a",
  ])("refuses %s", (value) => {
    expect(waitlistApiBase(value)).toBeNull();
  });
});

describe("waitlistMode in website mode", () => {
  it("is off without a good WAITLIST_API_BASE, whether WAITLIST is unset or 1", () => {
    expect(waitlistMode(undefined, "website", null)).toBe("off");
    expect(waitlistMode("1", "website", null)).toBe("off");
    expect(waitlistMode("", "website", null)).toBe("off");
  });
  it("is on with one", () => {
    expect(waitlistMode(undefined, "website", "https://api.stack19.com")).toBe("on");
    expect(waitlistMode("1", "website", "https://api.stack19.com")).toBe("on");
  });
  it("keeps off off, and mock (which stores nothing) needs no address", () => {
    expect(waitlistMode("off", "website", "https://api.stack19.com")).toBe("off");
    expect(waitlistMode("mock", "website", null)).toBe("mock");
  });
  it("does not change the app (staging): unset is off, 1 is on", () => {
    expect(waitlistMode(undefined, "app", null)).toBe("off");
    expect(waitlistMode("1", "app", null)).toBe("on");
  });
  it("reads the two settings from the environment at each call", () => {
    vi.stubEnv("SITE_MODE", "website");
    vi.stubEnv("WAITLIST", "1");
    vi.stubEnv("WAITLIST_API_BASE", "");
    expect(waitlistMode()).toBe("off");
    vi.stubEnv("WAITLIST_API_BASE", "https://api.stack19.com");
    expect(waitlistMode()).toBe("on");
  });
});

describe("the live website asks the API it was given, never the one built into the image", () => {
  const sent = (): string[] => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ privacy_version: "1" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    return calls;
  };
  it("website mode with WAITLIST_API_BASE: that address", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://sme-api-staging.example.run.app");
    vi.stubEnv("SITE_MODE", "website");
    vi.stubEnv("WAITLIST_API_BASE", "https://api.stack19.com");
    const calls = sent();
    await apiPublicRequest("/v1/privacy/notice");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("https://api.stack19.com/v1/privacy/notice");
  });
  it("the app (staging) ignores WAITLIST_API_BASE", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://sme-api-staging.example.run.app");
    vi.stubEnv("SITE_MODE", "");
    vi.stubEnv("WAITLIST_API_BASE", "https://api.stack19.com");
    const calls = sent();
    await apiPublicRequest("/v1/privacy/notice");
    expect(calls[0]).toBe("https://sme-api-staging.example.run.app/v1/privacy/notice");
  });
});
