import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postWaitlist = vi.fn();
vi.mock("@/lib/api/waitlist", () => ({ postWaitlist: (v: unknown) => postWaitlist(v) }));
const allow = vi.fn(() => true);
vi.mock("@/lib/site/lead-limit", () => ({ sharedLeadLimiter: () => ({ allow }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => (n === "x-forwarded-for" ? "203.0.113.9" : null) }) }));

import { joinWaitlist } from "./waitlist-actions";

const form = { name: "Lakshmi", businessType: "textiles", city: "Guntur", contact: "owner@shop.example", language: "en", consent: true, marketingOptIn: false, website: "" };
beforeEach(() => {
  vi.clearAllMocks();
  allow.mockReturnValue(true);
  postWaitlist.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("joinWaitlist (job DQ)", () => {
  it("posts a checked record to the API when the waitlist is on (WAITLIST=1, or unset in website mode)", async () => {
    vi.stubEnv("WAITLIST", "1");
    expect(await joinWaitlist(form)).toEqual({ ok: true });
    expect(postWaitlist).toHaveBeenCalledWith({ name: "Lakshmi", businessType: "textiles", city: "Guntur", phone: null, email: "owner@shop.example", language: "en", marketingOptIn: false });
    vi.unstubAllEnvs();
    vi.stubEnv("SITE_MODE", "website");
    vi.stubEnv("WAITLIST_API_BASE", "https://api.stack19.com");
    postWaitlist.mockClear();
    expect(await joinWaitlist(form)).toEqual({ ok: true });
    expect(postWaitlist).toHaveBeenCalledTimes(1);
  });

  it("the live website without WAITLIST_API_BASE sends nothing, even with WAITLIST=1 or unset (the address built into the image is staging's)", async () => {
    vi.stubEnv("SITE_MODE", "website");
    for (const value of ["1", ""]) {
      vi.stubEnv("WAITLIST", value);
      expect(await joinWaitlist(form)).toEqual({ ok: false, error: "down" });
    }
    vi.stubEnv("WAITLIST", "1");
    vi.stubEnv("WAITLIST_API_BASE", "https://sme-api-staging.example.com"); // a staging address is refused too
    expect(await joinWaitlist(form)).toEqual({ ok: false, error: "down" });
    expect(postWaitlist).not.toHaveBeenCalled();
  });

  it("is off in the usual mode: it sends nothing and says it could not", async () => {
    expect(await joinWaitlist(form)).toEqual({ ok: false, error: "down" });
    vi.stubEnv("WAITLIST", "off");
    vi.stubEnv("SITE_MODE", "website");
    expect(await joinWaitlist(form)).toEqual({ ok: false, error: "down" });
    expect(postWaitlist).not.toHaveBeenCalled();
  });

  it("mock keeps nothing: good answer, no call", async () => {
    vi.stubEnv("WAITLIST", "mock");
    expect(await joinWaitlist(form)).toEqual({ ok: true });
    expect(postWaitlist).not.toHaveBeenCalled();
  });

  it("checks every field first: a bad form is refused with the reason and never reaches the API or the limiter", async () => {
    vi.stubEnv("WAITLIST", "1");
    expect(await joinWaitlist({ ...form, contact: "x" })).toEqual({ ok: false, error: "contact" });
    expect(await joinWaitlist({ ...form, name: "" })).toEqual({ ok: false, error: "name" });
    expect(await joinWaitlist({ ...form, city: "" })).toEqual({ ok: false, error: "city" });
    expect(await joinWaitlist({ ...form, consent: false })).toEqual({ ok: false, error: "consent" }); // "Join early access": no ticked consent box, no entry
    expect(await joinWaitlist({ ...form, consent: undefined })).toEqual({ ok: false, error: "consent" });
    expect(await joinWaitlist({ ...form, consent: "true" })).toEqual({ ok: false, error: "consent" });
    expect(await joinWaitlist(undefined)).toEqual({ ok: false, error: "name" });
    expect(postWaitlist).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
  });

  it("the hidden field is the bots' trap: a quiet success that stores nothing", async () => {
    vi.stubEnv("WAITLIST", "1");
    expect(await joinWaitlist({ ...form, website: "https://spam.example" })).toEqual({ ok: true });
    expect(postWaitlist).not.toHaveBeenCalled();
  });

  it("an address that tried too often is told to wait", async () => {
    vi.stubEnv("WAITLIST", "1");
    allow.mockReturnValue(false);
    expect(await joinWaitlist(form)).toEqual({ ok: false, error: "rate" });
    expect(allow).toHaveBeenCalledWith("203.0.113.9");
    expect(postWaitlist).not.toHaveBeenCalled();
  });

  it("hands the API's answer back (a rate limit or a down API is not a thank-you)", async () => {
    vi.stubEnv("WAITLIST", "1");
    postWaitlist.mockResolvedValue({ ok: false, error: "down" });
    expect(await joinWaitlist(form)).toEqual({ ok: false, error: "down" });
  });
});
