import { describe, expect, it } from "vitest";

import { CALL_LANGS } from "./types";
import { mockTestCall, parseTestCall } from "./test-call";

const good = { mode: "fake", note: "Simulation.", transcript: [{ speaker: "assistant", text: "Hello" }, { speaker: "customer", text: "Yes" }], outcome: { outcome: "positive", category: "interested", reason: "Asked for details." } };

describe("the simulated test call (job DQ part 3)", () => {
  it("reads the contract's answer, as plain text, with its outcome", () => {
    expect(parseTestCall(good)).toEqual({ note: "Simulation.", transcript: good.transcript, outcome: good.outcome });
  });
  it("keeps the call when the outcome is missing or strange, but refuses an answer that is not marked fake, has a bad speaker, or is too long", () => {
    expect(parseTestCall({ ...good, outcome: null })?.outcome).toBeNull();
    expect(parseTestCall({ ...good, outcome: { outcome: "great", category: "x", reason: "y" } })?.outcome).toBeNull();
    expect(parseTestCall({ ...good, mode: "live" })).toBeNull();
    expect(parseTestCall({ ...good, transcript: [{ speaker: "robot", text: "x" }] })).toBeNull();
    expect(parseTestCall({ ...good, transcript: Array.from({ length: 31 }, () => good.transcript[0]) })).toBeNull();
    expect(parseTestCall({ ...good, note: "x".repeat(401) })).toBeNull();
    expect(parseTestCall(null)).toBeNull();
  });
  it("the fake call says the line of the saved settings (with the AI disclosure) in every call language and records an outcome", () => {
    for (const lang of CALL_LANGS) {
      const call = mockTestCall({ name: "Asha", lang, style: "warm", voice: "female_warm" } as never, "Acme Silks");
      expect(call.transcript).toHaveLength(3);
      expect(call.transcript[0].speaker).toBe("assistant");
      expect(call.transcript[0].text).toContain("Asha");
      expect(call.outcome?.outcome).toBe("positive");
      expect(call.note).toMatch(/simulation/i);
    }
  });
});
