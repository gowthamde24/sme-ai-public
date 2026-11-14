import { describe, expect, it } from "vitest";

import { parsePlan } from "@/lib/browser-voice/protocol";

import { parseConfirmAction } from "./turns";
import { languageTag, parseWhen } from "./plan-when";

const PLAN = { action_id: "55555555-5555-4555-8555-555555555555", title: "Call 28 people", summary: "S", steps: [], count: 28, channel: "call", estimate: null, expires_at: "2026-11-14T10:00:00Z" };
describe("the language tag and the structured time of a plan (owner-language contract)", () => {
  it("reads `when` and `language` when the API sends them, and ignores them when it does not (an older API)", () => {
    const plan = { ...PLAN, language: "te", when: { date: "2026-11-14", from_minute: 1080, to_minute: 1140 } };
    expect(parsePlan(plan)).toMatchObject({ language: "te", when: { date: "2026-11-14", fromMinute: 1080, toMinute: 1140 } });
    expect(parseConfirmAction(plan)).toMatchObject({ language: "te", when: { date: "2026-11-14", fromMinute: 1080, toMinute: 1140 } });
    expect(parsePlan(PLAN)).toMatchObject({ language: null, when: null });
    expect(parseConfirmAction(PLAN)).toMatchObject({ language: null, when: null });
  });
  it("a time that cannot be read is simply not drawn; the plan itself still is", () => {
    expect(parseWhen({ date: "tomorrow", from_minute: 600 })).toBeNull();
    expect(parseWhen({ date: "2026-11-14", from_minute: 2000 })).toBeNull();
    expect(parseWhen({ date: "2026-11-14", from_minute: 600, to_minute: "x" })).toEqual({ date: "2026-11-14", fromMinute: 600, toMinute: null });
    expect(parseWhen(null)).toBeNull();
    expect(parsePlan({ ...PLAN, when: "soon" })).toMatchObject({ when: null });
  });
  it("a language tag is a short lowercase code, anything else is null", () => {
    expect(languageTag("kn")).toBe("kn");
    expect(languageTag("TE")).toBeNull();
    expect(languageTag(5)).toBeNull();
    expect(languageTag("<script>")).toBeNull();
  });
});
