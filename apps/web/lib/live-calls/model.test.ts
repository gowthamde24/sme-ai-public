import { describe, expect, it } from "vitest";

import { liveWire, parseLiveWire, sourceKeyOf } from "./model";

const ID = "33333333-3333-4333-8333-333333333333";

describe("sourceKeyOf", () => {
  it.each([
    ["indiamart", "indiamart"],
    ["IndiaMART enquiry", "indiamart"],
    ["India Mart", "indiamart"],
    ["website form", "website"],
    ["e-mail", "email"],
    ["google sheet", "sheet"],
    ["Meta lead ads", "meta"],
    ["typed in", "typed"],
  ])("%s is %s", (given, key) => expect(sourceKeyOf(given)).toBe(key));
  it("a source we have no word for is not guessed", () => {
    expect(sourceKeyOf("referral from Ravi")).toBeNull();
    expect(sourceKeyOf(null)).toBeNull();
    expect(sourceKeyOf("")).toBeNull();
  });
});

describe("parseLiveWire", () => {
  it("reads each call field by field, and says whether the caller has a name", () => {
    const w = parseLiveWire({ calls: [{ id: ID, who: "Lakshmi", elapsed_s: 4, answered: true, source: "indiamart", can_take_over: true }, { id: ID, who: "Caller ending 998", elapsed_s: 9, answered: false, source: "bogus", can_take_over: "yes" }], poll_after_s: 5 });
    expect(w?.calls[0]).toEqual({ id: ID, who: "Lakshmi", named: true, elapsedS: 4, answered: true, source: "indiamart", canTakeOver: true });
    expect(w?.calls[1]).toMatchObject({ named: false, source: null, canTakeOver: false, answered: false });
  });
  it("drops what cannot be read and keeps the rest", () => {
    const w = parseLiveWire({ calls: [{ id: "x", who: "A" }, null, { id: ID, who: 7, elapsed_s: -3 }], poll_after_s: 1 });
    expect(w?.calls).toHaveLength(1);
    expect(w?.calls[0]).toMatchObject({ who: "", elapsedS: 0 });
    expect(w?.pollAfterS).toBe(3);
  });
  it("is null when it is not the answer at all", () => {
    expect(parseLiveWire(null)).toBeNull();
    expect(parseLiveWire({ items: [] })).toBeNull();
  });
  it("what the route sends is what the browser reads, with no phone number field anywhere", () => {
    const out = liveWire({ calls: [{ id: ID, who: "Lakshmi", named: true, elapsedS: 4, answered: true, source: "email", canTakeOver: false }], pollAfterS: 5 });
    expect(Object.keys(out.calls[0]).sort()).toEqual(["answered", "can_take_over", "elapsed_s", "id", "source", "who"]);
    expect(parseLiveWire(out)?.calls[0].source).toBe("email");
  });
});
