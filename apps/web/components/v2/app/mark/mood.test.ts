import { describe, expect, it } from "vitest";

import { aiMood, RESTING_CODES, type MoodInput } from "./mood";

const base: MoodInput = { live: true, typing: false, phase: "idle", hasText: false };

describe("aiMood: the Ask box's state as the owl's mood", () => {
  it("idle: nothing is happening", () => {
    expect(aiMood(base)).toBe("idle");
    expect(aiMood({ ...base, phase: "done", hasText: true })).toBe("idle"); // an answer that is finished is not "answering"
  });
  it("listening: the input is focused and the person is typing, or the microphone is on", () => {
    expect(aiMood({ ...base, typing: true })).toBe("listening");
    expect(aiMood({ ...base, micOn: true })).toBe("listening");
  });
  it("thinking: the request is sent and no `text` event has come yet", () => {
    expect(aiMood({ ...base, phase: "asking" })).toBe("thinking");
    expect(aiMood({ ...base, phase: "asking", typing: true })).toBe("thinking"); // the box clears the input on send; asking wins anyway
  });
  it("answering: `text` events are streaming", () => {
    expect(aiMood({ ...base, phase: "asking", hasText: true })).toBe("answering");
  });
  it("resting: not live, or the answer was refused with ai_paused_until, agents_disabled or run_limit_reached", () => {
    expect(aiMood({ ...base, live: false })).toBe("resting");
    expect(aiMood({ ...base, live: false, typing: true, phase: "asking" })).toBe("resting");
    expect([...RESTING_CODES].sort()).toEqual(["agents_disabled", "ai_paused_until", "run_limit_reached"]);
    for (const code of RESTING_CODES) expect(aiMood({ ...base, phase: "error", errorCode: code })).toBe("resting");
  });
  it("voice (job BF): listening while recording, thinking while the recording is understood, answering while text streams and while the spoken answer plays", () => {
    expect(aiMood({ ...base, micOn: true })).toBe("listening");
    expect(aiMood({ ...base, micOn: true, phase: "asking", hasText: true })).toBe("listening"); // recording wins over an answer still on screen
    expect(aiMood({ ...base, phase: "asking" })).toBe("thinking"); // the recording was sent; no text yet
    expect(aiMood({ ...base, phase: "asking", hasText: true })).toBe("answering");
    expect(aiMood({ ...base, phase: "done", hasText: true, speaking: true })).toBe("answering"); // the written answer is whole, the spoken one is playing
    expect(aiMood({ ...base, phase: "done", hasText: true, speaking: false })).toBe("idle");
    expect(aiMood({ ...base, live: false, micOn: true, speaking: true })).toBe("resting");
    expect(aiMood({ ...base, phase: "error", errorCode: "ai_paused_until", speaking: true })).toBe("resting");
  });
  it("any other failure leaves the owl idle (a busy or unconfigured model is not a rest)", () => {
    for (const code of ["model_busy", "model_not_configured", "forbidden", null, undefined, "x"]) expect(aiMood({ ...base, phase: "error", errorCode: code })).toBe("idle");
  });
});
