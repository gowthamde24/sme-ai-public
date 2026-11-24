import { afterEach, describe, expect, it, vi } from "vitest";

import { leadsOpen, pronunciationScreens, reportsOpen, callsOpen, filtersOpen, todayOpen, firstDayOpen, settingsOpen, templatesPlain, myAssistantOpen, firstRunType, assistantScreens, assistantWorkScreens, balanceScreens, callScreens, earlyAccess, outcomeScreens, planTierScreens, screenMode, topupScreens } from "./flag";
import { enabledFeatures } from "./features";

describe("the flags of the live call, outcomes and AI assistant screens", () => {
  it("are off unless the value is exactly 1 or mock", () => {
    for (const v of [undefined, "", "0", "yes", "true", "MOCK", " 1"]) expect(screenMode(v), String(v)).toBe("off");
    expect(screenMode("1")).toBe("on");
    expect(screenMode("mock")).toBe("mock");
  });
  it("each reads its own variable when the server handles a request", () => {
    expect([callScreens("mock"), outcomeScreens("1"), assistantScreens(undefined)]).toEqual(["mock", "on", "off"]);
    const keep = { ...process.env };
    try {
      process.env.CALL_SCREENS = "mock";
      delete process.env.OUTCOME_SCREENS;
      process.env.ASSISTANT_SCREENS = "1";
      expect([callScreens(), outcomeScreens(), assistantScreens()]).toEqual(["mock", "off", "on"]);
    } finally {
      process.env = keep;
    }
  });
});

describe("the assistant does the work, per workspace (ASSISTANT_WORK_TENANTS, C1 5 Nov)", () => {
  const A = "c029cba3-d2f8-4923-8c5a-630852797fd3";
  const B = "7013c5ff-7f60-4b9e-ba9b-ac7bbc32651e";
  const C = "5717d629-9289-4480-b895-59abb65ce2ce";
  it("unset: every workspace, as before", () => {
    expect([assistantWorkScreens(A, "1", undefined), assistantWorkScreens(A, "mock", undefined), assistantWorkScreens(A, undefined, undefined)]).toEqual(["on", "mock", "off"]);
  });
  it("a list (; or ,, any case, spaces): only the workspaces in it", () => {
    for (const list of [`${A};${B}`, `${B}, ${A.toUpperCase()}`, ` ${A} `]) expect(assistantWorkScreens(A, "1", list), list).toBe("on");
    expect(assistantWorkScreens(C, "1", `${A};${B}`)).toBe("off");
    expect(assistantWorkScreens(C, "mock", `${A};${B}`)).toBe("off");
    expect(assistantWorkScreens(A.slice(0, 8), "1", A)).toBe("off");
  });
  it("set but empty, or none: no workspace", () => {
    for (const list of ["", " ", ";", "none", "NONE"]) expect(assistantWorkScreens(A, "1", list), JSON.stringify(list)).toBe("off");
  });
  it("the list never turns the part on by itself", () => {
    expect(assistantWorkScreens(A, undefined, A)).toBe("off");
  });
});

describe("free early access (owner's launch scope, 18 Nov)", () => {
  it("is on only for exactly 1", () => {
    expect(earlyAccess("1")).toBe(true);
    for (const v of [undefined, "", "0", "mock", "true", "on"]) expect(earlyAccess(v), String(v)).toBe(false);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("turns the money screens off whatever their own flags say, and names the feature", () => {
    vi.stubEnv("EARLY_ACCESS", "1");
    vi.stubEnv("TOPUP_SCREENS", "1");
    vi.stubEnv("BALANCE_SCREENS", "1");
    vi.stubEnv("PLAN_TIER_SCREENS", "1");
    expect([topupScreens(), balanceScreens(), planTierScreens()]).toEqual(["off", "off", "off"]);
    expect(enabledFeatures()).toContain("early_access");
    expect(enabledFeatures()).not.toContain("topups");
  });
  it("without it the money screens follow their own flags", () => {
    vi.stubEnv("EARLY_ACCESS", ""); // (a stub of an earlier test may linger in this worker)
    vi.stubEnv("TOPUP_SCREENS", "1");
    expect(topupScreens()).toBe("on");
    expect(enabledFeatures()).not.toContain("early_access");
  });
});

describe("the flags that only change a screen's look are on for exactly 1, from their own variable", () => {
  it("is off for anything else, and reads its own variable at request time", () => {
    const fns = { leadsOpen, reportsOpen, callsOpen, filtersOpen, todayOpen, firstDayOpen, settingsOpen, templatesPlain, myAssistantOpen, firstRunType } as const;
    for (const [name, fn] of Object.entries(fns)) {
      for (const v of [undefined, "", "0", "yes", "true", "mock", " 1"]) expect(fn(v), `${name}(${String(v)})`).toBe(false);
      expect(fn("1"), name).toBe(true);
    }
    vi.stubEnv("LEADS_OPEN", "1");
    expect(leadsOpen()).toBe(true);
    vi.stubEnv("LEADS_OPEN", "");
    expect(leadsOpen()).toBe(false);
  });
  it("PRONUNCIATION_SCREENS is a screen mode: off, mock or on", () => {
    expect([pronunciationScreens(undefined), pronunciationScreens("mock"), pronunciationScreens("1")]).toEqual(["off", "mock", "on"]);
  });
});
