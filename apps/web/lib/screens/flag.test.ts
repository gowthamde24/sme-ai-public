import { describe, expect, it } from "vitest";

import { assistantScreens, callScreens, outcomeScreens, screenMode } from "./flag";

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
