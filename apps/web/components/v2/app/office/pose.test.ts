import { describe, expect, it } from "vitest";

import { drawOf, poseOf, type ApiState } from "./pose";

describe("the pose of a helper in the office follows the API's state", () => {
  it("working types, idle sits, switched off and not built are off", () => {
    const states: ApiState[] = ["working", "idle", "switched_off", "not_available"];
    expect(states.map(poseOf)).toEqual(["working", "idle", "off", "off"]);
  });
  it("working: the typing pose and a glowing laptop; idle: breathing and blinking, no laptop", () => {
    expect(drawOf("working", false)).toEqual({ mood: "idle", still: false, working: true, laptop: true, faded: false });
    expect(drawOf("idle", false)).toEqual({ mood: "idle", still: false, working: false, laptop: false, faded: false });
  });
  it("off: a still picture at 45 % opacity, with no laptop and no animation, whatever the device", () => {
    for (const lite of [false, true]) expect(drawOf("off", lite)).toEqual({ mood: "idle", still: true, working: false, laptop: false, faded: true });
  });
  it("reduced motion or a data saver: every owl is a still picture, and a working helper keeps its lit laptop", () => {
    expect(drawOf("idle", true)).toMatchObject({ still: true, working: false, laptop: false });
    expect(drawOf("working", true)).toMatchObject({ still: true, working: false, laptop: true });
  });
});
