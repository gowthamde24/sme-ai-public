import { describe, expect, it } from "vitest";

import { owlMood, RESTING_CODES, type MoodInput } from "./owl-mood";

const base: MoodInput = { live: true, typing: false, phase: "idle", hasText: false };

describe("owlMood: the Ask box's state as the owl's mood", () => {
  it("idle: nothing is happening", () => {
    expect(owlMood(base)).toBe("idle");
    expect(owlMood({ ...base, phase: "done", hasText: true })).toBe("idle"); // an answer that is finished is not "answering"
  });
  it("listening: the input is focused and the person is typing, or the microphone is on", () => {
    expect(owlMood({ ...base, typing: true })).toBe("listening");
    expect(owlMood({ ...base, micOn: true })).toBe("listening");
  });
  it("thinking: the request is sent and no `text` event has come yet", () => {
    expect(owlMood({ ...base, phase: "asking" })).toBe("thinking");
    expect(owlMood({ ...base, phase: "asking", typing: true })).toBe("thinking"); // the box clears the input on send; asking wins anyway
  });
  it("answering: `text` events are streaming", () => {
    expect(owlMood({ ...base, phase: "asking", hasText: true })).toBe("answering");
  });
  it("resting: not live, or the answer was refused with ai_paused_until, agents_disabled or run_limit_reached", () => {
    expect(owlMood({ ...base, live: false })).toBe("resting");
    expect(owlMood({ ...base, live: false, typing: true, phase: "asking" })).toBe("resting");
    expect([...RESTING_CODES].sort()).toEqual(["agents_disabled", "ai_paused_until", "run_limit_reached"]);
    for (const code of RESTING_CODES) expect(owlMood({ ...base, phase: "error", errorCode: code })).toBe("resting");
  });
  it("voice (job BF): listening while recording, thinking while the recording is understood, answering while text streams and while the spoken answer plays", () => {
    expect(owlMood({ ...base, micOn: true })).toBe("listening");
    expect(owlMood({ ...base, micOn: true, phase: "asking", hasText: true })).toBe("listening"); // recording wins over an answer still on screen
    expect(owlMood({ ...base, phase: "asking" })).toBe("thinking"); // the recording was sent; no text yet
    expect(owlMood({ ...base, phase: "asking", hasText: true })).toBe("answering");
    expect(owlMood({ ...base, phase: "done", hasText: true, speaking: true })).toBe("answering"); // the written answer is whole, the spoken one is playing
    expect(owlMood({ ...base, phase: "done", hasText: true, speaking: false })).toBe("idle");
    expect(owlMood({ ...base, live: false, micOn: true, speaking: true })).toBe("resting");
    expect(owlMood({ ...base, phase: "error", errorCode: "ai_paused_until", speaking: true })).toBe("resting");
  });
  it("any other failure leaves the owl idle (a busy or unconfigured model is not a rest)", () => {
    for (const code of ["model_busy", "model_not_configured", "forbidden", null, undefined, "x"]) expect(owlMood({ ...base, phase: "error", errorCode: code })).toBe("idle");
  });
});
