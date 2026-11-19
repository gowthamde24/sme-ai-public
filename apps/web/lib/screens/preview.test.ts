import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", () => ({ workUnitAsyncStorage: { getStore: () => h.store } }));

import { billingV2, jobsScreens } from "./flag";
import { PREVIEW_COOKIE, PREVIEW_VALUE, previewAllowed, previewOn } from "./preview";

const request = (value: string | undefined) => ({ type: "request", cookies: { get: (n: string) => (n === PREVIEW_COOKIE && value !== undefined ? { name: n, value } : undefined) } });

afterEach(() => {
  vi.unstubAllEnvs();
  h.store = undefined;
});

describe("the staging preview of the JOBS and BILLING_V2 screens (one browser, sample data)", () => {
  it("is allowed only where PREVIEW_JOBS=1 (staging)", () => {
    expect(previewAllowed(undefined)).toBe(false);
    expect(previewAllowed("0")).toBe(false);
    expect(previewAllowed("true")).toBe(false);
    expect(previewAllowed("1")).toBe(true);
  });
  it("PRODUCTION (no PREVIEW_JOBS) ignores the cookie: the flags answer what the environment says", () => {
    vi.stubEnv("JOBS", "");
    vi.stubEnv("BILLING_V2", "");
    vi.stubEnv("PREVIEW_JOBS", "");
    h.store = request(PREVIEW_VALUE);
    expect(previewOn()).toBe(false);
    expect(jobsScreens()).toBe("off");
    expect(billingV2()).toBe("off");
    vi.stubEnv("JOBS", "1");
    expect(jobsScreens()).toBe("on");
  });
  it("staging with the cookie: both flags are mock for this request", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    vi.stubEnv("JOBS", "");
    vi.stubEnv("BILLING_V2", "");
    h.store = request(PREVIEW_VALUE);
    expect(previewOn()).toBe(true);
    expect(jobsScreens()).toBe("mock");
    expect(billingV2()).toBe("mock");
  });
  it("staging without the cookie, or with another value: nothing changes", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    vi.stubEnv("JOBS", "");
    vi.stubEnv("BILLING_V2", "");
    for (const v of [undefined, "", "1", "on"]) {
      h.store = request(v);
      expect(previewOn(), String(v)).toBe(false);
      expect(jobsScreens()).toBe("off");
    }
  });
  it("outside a request (tests, build) or on a surprise from Next it is simply off", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    h.store = undefined;
    expect(previewOn()).toBe(false);
    h.store = { type: "prerender" };
    expect(previewOn()).toBe(false);
    h.store = { type: "request", cookies: null };
    expect(previewOn()).toBe(false);
  });
  it("an explicit value (a test, a caller) always wins over the preview", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    h.store = request(PREVIEW_VALUE);
    expect(jobsScreens("off")).toBe("off");
    expect(billingV2("1")).toBe("on");
  });
});
