import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", () => ({ workUnitAsyncStorage: { getStore: () => h.store } }));

import { billingV2, jobsScreens } from "./flag";
import { choiceOfWord, parsePreview, PICKER_WORDS, pickerWordOf, PREVIEW_COOKIE, PREVIEW_VALUE, previewAllowed, previewChoice, previewMine, previewMode, previewOn, previewSample, previewValue, SAMPLE_TYPES } from "./preview";

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
  it("staging with the plain cookie (my business): both flags use the real routes for this request", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    vi.stubEnv("JOBS", "");
    vi.stubEnv("BILLING_V2", "");
    h.store = request(PREVIEW_VALUE);
    expect(previewOn()).toBe(true);
    expect(previewMine()).toBe(true);
    expect(previewSample()).toBeNull();
    expect(jobsScreens()).toBe("on");
    expect(billingV2()).toBe("on");
  });
  it("staging with a sample business: both flags are mock, and the sample is the word after jobs:", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    vi.stubEnv("JOBS", "1");
    vi.stubEnv("BILLING_V2", "1");
    for (const type of SAMPLE_TYPES) {
      h.store = request(`jobs:${type}`);
      expect(previewOn(), type).toBe(true);
      expect(previewMine(), type).toBe(false);
      expect(previewSample(), type).toBe(type);
      expect(jobsScreens(), type).toBe("mock");
      expect(billingV2(), type).toBe("mock");
    }
  });
  it("an unknown word after jobs: is my business (the default), never a sample", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    for (const v of ["jobs:", "jobs:unknown", "jobs:SAREE", "jobs:saree ", "jobs:mine", "jobs:saree:cars"]) {
      h.store = request(v);
      expect(previewChoice(), v).toEqual({ kind: "mine" });
      expect(previewSample(), v).toBeNull();
    }
  });
  it("PRODUCTION ignores a sample cookie too", () => {
    vi.stubEnv("PREVIEW_JOBS", "");
    vi.stubEnv("JOBS", "");
    h.store = request("jobs:school");
    expect(previewChoice()).toBeNull();
    expect(previewSample()).toBeNull();
    expect(previewMode()).toBeUndefined();
    expect(jobsScreens()).toBe("off");
  });
  it("staging without the cookie, or with another value: nothing changes", () => {
    vi.stubEnv("PREVIEW_JOBS", "1");
    vi.stubEnv("JOBS", "");
    vi.stubEnv("BILLING_V2", "");
    for (const v of [undefined, "", "1", "on", "jobsx", "Jobs", "job", "jobs/saree", "saree"]) {
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

describe("the cookie value", () => {
  it("parses jobs, jobs:<sample> and nothing else", () => {
    expect(parsePreview(undefined)).toBeNull();
    expect(parsePreview("")).toBeNull();
    expect(parsePreview("jobs")).toEqual({ kind: "mine" });
    expect(parsePreview("jobs:cars")).toEqual({ kind: "sample", type: "cars" });
    expect(parsePreview("jobs:realestate")).toEqual({ kind: "sample", type: "realestate" });
    expect(parsePreview("jobs:nonsense")).toEqual({ kind: "mine" });
    expect(parsePreview("sample:cars")).toBeNull();
  });
  it("a choice goes to the cookie value and back (the closed list)", () => {
    expect(previewValue({ kind: "mine" })).toBe("jobs");
    for (const type of SAMPLE_TYPES) expect(parsePreview(previewValue({ kind: "sample", type }))).toEqual({ kind: "sample", type });
    expect(SAMPLE_TYPES).toEqual(["saree", "realestate", "school", "cars"]);
  });
  it("the picker's words: an unknown word is my business", () => {
    expect(PICKER_WORDS).toEqual(["mine", "saree", "realestate", "school", "cars"]);
    expect(choiceOfWord("school")).toEqual({ kind: "sample", type: "school" });
    for (const w of ["mine", "", "x", null, undefined, 3]) expect(choiceOfWord(w)).toEqual({ kind: "mine" });
    expect(pickerWordOf(null)).toBe("mine");
    expect(pickerWordOf({ kind: "sample", type: "cars" })).toBe("cars");
  });
});
