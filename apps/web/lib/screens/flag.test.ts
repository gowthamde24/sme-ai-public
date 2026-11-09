import { describe, expect, it } from "vitest";

import { aiTeamScreens, assistantScreens, assistantWorkScreens, callScreens, outcomeScreens, screenMode } from "./flag";

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

describe("the AI team page under app v4 (part 7)", () => {
  it("app v4 turns the API's page on when the flag is unset, and never overrides mock or an explicit 1", () => {
    expect(aiTeamScreens(undefined, true)).toBe("on");
    expect(aiTeamScreens("", true)).toBe("on");
    expect(aiTeamScreens("mock", true)).toBe("mock");
    expect(aiTeamScreens("1", true)).toBe("on");
  });
  it("without app v4 it is as it was: unset is off", () => {
    expect(aiTeamScreens(undefined, false)).toBe("off");
    expect(aiTeamScreens("1", false)).toBe("on");
  });
});

