import { describe, expect, it } from "vitest";

import { guessFabric } from "./fabric-guess";

describe("the fabric a name points to", () => {
  it.each([
    ["TEST Mysore silk", "mysore_silk"],
    ["Banarasi brocade", "banarasi"],
    ["Cotton silk festival", "cotton_silk"],
    ["Cotton handloom", "pure_cotton"],
    ["Maroon Kanchipuram with temple border", "kanchi_pattu"],
    ["ధర్మవరం పట్టు చీర", "dharmavaram_silk"],
  ])("%s -> %s", (name, fabric) => expect(guessFabric(name)).toBe(fabric));
  it("says nothing when the name says nothing", () => {
    expect(guessFabric("")).toBeNull();
    expect(guessFabric("Red wedding saree")).toBeNull();
  });
});
