import { describe, expect, it } from "vitest";

import { PROSPECT, PROSPECT_STRONG } from "./lead-finder-fixtures";
import { parseProspect } from "./lead-finder";

describe("talking points of a prospect (JOBS, optional)", () => {
  it("are read from talking_points, only when the API sends them", () => {
    expect(parseProspect(PROSPECT_STRONG).talkingPoints).toEqual(["Ask if they stock Pochampally ikat, which they do not list online", "Offer a sample set of 5 sarees to look at", "Mention you already supply 3 shops nearby"]);
    expect("talkingPoints" in parseProspect(PROSPECT)).toBe(false);
    expect("talkingPoints" in parseProspect({ ...PROSPECT, talking_points: [] })).toBe(false);
    expect("talkingPoints" in parseProspect({ ...PROSPECT, talking_points: null })).toBe(false);
  });
  it("are cut to 5 lines of 200 characters, blank lines dropped, and are trimmed", () => {
    const p = parseProspect({ ...PROSPECT, talking_points: ["  one  ", "", "x".repeat(300), "3", "4", "5", "6", "7"] });
    expect(p.talkingPoints).toHaveLength(5);
    expect(p.talkingPoints?.[0]).toBe("one");
    expect(p.talkingPoints?.[1]).toHaveLength(200);
  });
  it("are a contract error when they are not a list of strings", () => {
    expect(() => parseProspect({ ...PROSPECT, talking_points: "say hello" })).toThrow();
    expect(() => parseProspect({ ...PROSPECT, talking_points: [1, 2] })).toThrow();
  });
});
