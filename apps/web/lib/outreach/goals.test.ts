import { describe, expect, it } from "vitest";

import { goalsForPack } from "./goals";

describe("the goals of a business type's rule", () => {
  it("a saree shop gets its own and the general ones, not a test drive or a counselling session", () => {
    const g = goalsForPack("textiles");
    expect(g).toEqual(["site_visit", "qualify", "quote", "callback", "general"]);
    expect(g).not.toContain("test_drive");
    expect(g).not.toContain("counselling");
  });
  it("a car dealer gets the test drive; a coaching centre the counselling session", () => {
    expect(goalsForPack("auto_dealer")).toContain("test_drive");
    expect(goalsForPack("auto_dealer")).not.toContain("site_visit");
    expect(goalsForPack("coaching")).toContain("counselling");
  });
  it("a business type it does not know, or none, gets every goal (null = no filter)", () => {
    expect(goalsForPack("something_new")).toBeNull();
    expect(goalsForPack(null)).toBeNull();
    expect(goalsForPack(undefined)).toBeNull();
  });
  it("every business type's own goal is offered to it", () => {
    for (const id of ["clinic", "gym", "real_estate", "travel", "interiors_solar"]) expect(goalsForPack(id)?.length).toBeGreaterThan(3);
  });
});

import { withBusinessName } from "./goals";

describe("a template preview with the real business name (owner, 17 Nov)", () => {
  it("replaces the sample business, and drops a demo workspace's (demo)", () => {
    expect(withBusinessName("Hello Ravi, thank you for contacting Sri Lakshmi Silks.", "Neelambari Silks (demo)")).toBe("Hello Ravi, thank you for contacting Neelambari Silks.");
    expect(withBusinessName("Sri Lakshmi Silks and Sri Lakshmi Silks", "Padma Textiles")).toBe("Padma Textiles and Padma Textiles");
  });
  it("leaves the preview alone when the name is not known", () => {
    expect(withBusinessName("Hello Ravi, Sri Lakshmi Silks.", null)).toBe("Hello Ravi, Sri Lakshmi Silks.");
    expect(withBusinessName("Hello Ravi, Sri Lakshmi Silks.", "  (demo) ")).toBe("Hello Ravi, Sri Lakshmi Silks.");
  });
});
