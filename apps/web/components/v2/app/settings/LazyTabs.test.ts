import { describe, expect, it, vi } from "vitest";

import * as eager from "./LazyTabs.eager";
const lazy = await vi.importActual<typeof import("./LazyTabs")>("./LazyTabs");

describe("Settings tabs as chunks", () => {
  it("the test copy has exactly the parts of the lazy file", () => {
    expect(Object.keys(eager).sort()).toEqual(Object.keys(lazy).sort());
  });
});
