import { describe, expect, it } from "vitest";

import { EMPTY, MIN_VISITS, NEW_VISIT_AFTER_MS, SNOOZE_MS, dismiss, howTo, markInstalled, parseState, recordVisit, shouldShow } from "./install-hint";

const PHONE = { phone: true, standalone: false };
const T0 = 1_700_000_000_000;
const visits = (n: number) => Array.from({ length: n }).reduce<ReturnType<typeof recordVisit>>((s, _, i) => recordVisit(s, T0 + i * 2 * NEW_VISIT_AFTER_MS), EMPTY);

describe("install hint: when to offer it", () => {
  it("counts a visit only when the last page view was long enough ago", () => {
    let s = recordVisit(EMPTY, T0);
    expect(s.visits).toBe(1);
    s = recordVisit(s, T0 + 60_000); // a reload or a click-through
    expect(s.visits).toBe(1);
    s = recordVisit(s, T0 + 60_000 + NEW_VISIT_AFTER_MS);
    expect(s.visits).toBe(2);
  });
  it("is gentle: not before the third visit", () => {
    expect(shouldShow(visits(MIN_VISITS - 1), PHONE, T0 + 1e9)).toBe(false);
    expect(shouldShow(visits(MIN_VISITS), PHONE, T0 + 1e9)).toBe(true);
  });
  it("only on a phone, and never inside the installed app", () => {
    const s = visits(5);
    expect(shouldShow(s, { phone: false, standalone: false }, T0)).toBe(false);
    expect(shouldShow(s, { phone: true, standalone: true }, T0)).toBe(false);
  });
  it("'Not now' keeps it away for 30 days, then it may come back once", () => {
    const closed = dismiss(visits(4), T0);
    expect(shouldShow(closed, PHONE, T0 + SNOOZE_MS - 1)).toBe(false);
    expect(shouldShow(closed, PHONE, T0 + SNOOZE_MS)).toBe(true);
  });
  it("never again after the app was installed", () => {
    expect(shouldShow(markInstalled(visits(9)), PHONE, T0 + 9 * SNOOZE_MS)).toBe(false);
  });
});

describe("install hint: what is stored", () => {
  it("reads back what it wrote and treats anything else as a fresh start", () => {
    const s = dismiss(visits(3), T0);
    expect(parseState(JSON.stringify(s))).toEqual(s);
    for (const bad of [null, "", "nope", "[]", '{"visits":"3"}', '{"visits":-4,"last":"x"}']) expect(parseState(bad)).toEqual(expect.objectContaining({ installed: false }));
    expect(parseState('{"visits":"3"}').visits).toBe(0);
    expect(parseState('{"visits":99999}').visits).toBe(1000);
  });
  it("picks the how-to by the browser", () => {
    expect(howTo("Mozilla/5.0 (Linux; Android 14) Chrome/130", true)).toBe("prompt");
    expect(howTo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", false)).toBe("ios");
    expect(howTo("Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0", false)).toBe("other");
  });
});
