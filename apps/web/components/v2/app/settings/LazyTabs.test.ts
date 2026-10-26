import { describe, expect, it } from "vitest";

import * as eager from "./LazyTabs.eager";
import * as lazy from "./LazyTabs";

describe("Settings tabs as chunks", () => {
  it("the test copy has exactly the parts of the lazy file", () => {
    expect(Object.keys(eager).sort()).toEqual(Object.keys(lazy).sort());
  });
});
