import { describe, expect, it } from "vitest";

import { applyOverride, diffOverride, FIELD_GROUP, OVERRIDABLE, overriddenFields, parseOverride } from "./campaign";
import { defaultCallSettings } from "./types";

const base = defaultCallSettings(null);

describe("a campaign's call settings (job DQ part 3)", () => {
  it("sends only what differs from the workspace, and nothing when nothing differs", () => {
    expect(diffOverride(base, base)).toEqual({});
    expect(diffOverride(base, { ...base, concurrent_calls: base.concurrent_calls + 1 })).toEqual({ concurrent_calls: base.concurrent_calls + 1 });
  });
  it("says 'never pause by itself, here' as auto_pause_off, and cannot say 'follow the assistant's hours' as an override", () => {
    const withPause = { ...base, auto_pause_refusals_per_hour: 5 };
    expect(diffOverride(withPause, { ...withPause, auto_pause_refusals_per_hour: null })).toEqual({ auto_pause_off: true });
    expect(diffOverride({ ...base, hours: { ...(base.hours as object) } as never }, { ...base, hours: null })).toEqual({});
  });
  it("lays an override over the workspace's settings and marks the fields that differ by value", () => {
    const eff = applyOverride({ ...base, auto_pause_refusals_per_hour: 5 }, { concurrent_calls: 7, auto_pause_off: true });
    expect(eff.concurrent_calls).toBe(7);
    expect(eff.auto_pause_refusals_per_hour).toBeNull();
    expect(overriddenFields({ ...base, auto_pause_refusals_per_hour: 5 }, eff).sort()).toEqual(["auto_pause_refusals_per_hour", "concurrent_calls"]);
    expect(overriddenFields(base, base)).toEqual([]);
  });
  it("every changeable field has a group, and the holidays, hand-over people and purposes are not changeable", () => {
    for (const k of OVERRIDABLE) expect(FIELD_GROUP[k]).toBeTruthy();
    expect(OVERRIDABLE).not.toContain("holidays");
    expect(OVERRIDABLE).not.toContain("purposes");
  });
  it("reads a form's override only when the whole is valid call settings and every key is known", () => {
    expect(parseOverride({ concurrent_calls: 2 }, base)).toEqual({ concurrent_calls: 2 });
    expect(parseOverride({ concurrent_calls: 9999 }, base)).toBeNull();
    expect(parseOverride({ holidays: [] }, base)).toBeNull();
    expect(parseOverride({ auto_pause_off: false }, base)).toBeNull();
    expect(parseOverride({ auto_pause_off: true }, base)).toEqual({ auto_pause_off: true });
    expect(parseOverride([], base)).toBeNull();
    expect(parseOverride(null, base)).toBeNull();
  });
});
