import { describe, expect, it } from "vitest";

import { DEFAULT_SPEED_RULE, parseSpeedInput, parseSpeedRules, speedRulesBody } from "./speed";

describe("speed-to-lead rules", () => {
  it("round-trip the API's shape: default, an own rule for one source, null for the rest", () => {
    const own = { ...DEFAULT_SPEED_RULE, callWithinMinutes: 5, callAtMinute: 600 };
    const body = speedRulesBody({ default: DEFAULT_SPEED_RULE, perSource: { meta: own } });
    expect(body.default.in_hours).toEqual({ action: "call", call_within_minutes: 2 });
    expect(body.default.after_hours).toEqual({ whatsapp_now: true, call_at_minute: 600 });
    const back = parseSpeedRules(body);
    expect(back?.perSource.meta).toEqual(own);
    expect(back?.perSource.website).toBeNull();
  });
  it("an own rule the app cannot read follows the default instead of showing a wrong one; an unreadable default is refused", () => {
    const body = speedRulesBody({ default: DEFAULT_SPEED_RULE, perSource: {} }) as Record<string, unknown>;
    expect(parseSpeedRules({ ...body, per_source: { meta: { enabled: "yes" } } })?.perSource.meta).toBeNull();
    expect(parseSpeedRules({ ...body, default: { enabled: true } })).toBeNull();
  });
  it("the browser's input is held to the API's ranges", () => {
    const ok = { default: DEFAULT_SPEED_RULE, perSource: {} };
    expect(parseSpeedInput(ok)).not.toBeNull();
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, callWithinMinutes: 0 } })).toBeNull();
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, callWithinMinutes: 121 } })).toBeNull();
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, callAtMinute: 575 } })).toBeNull(); // steps of 15
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, callAtMinute: 480 } })).toBeNull();
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, maxAttempts: 7 } })).toBeNull();
    expect(parseSpeedInput({ ...ok, default: { ...DEFAULT_SPEED_RULE, handoffTo: "a b" } })).toBeNull();
    expect(parseSpeedInput({ ...ok, perSource: { meta: { enabled: true } } })).toBeNull();
    expect(parseSpeedInput("nope")).toBeNull();
  });
});
