import { describe, expect, it } from "vitest";

import { moduleOn } from "@/lib/api/pack";

import { hasModule } from "./has";

describe("does the business type have the module", () => {
  it("is strict: no pack means no module (unlike moduleOn, which lets a workspace with no pack keep every screen)", () => {
    expect(hasModule(null, "materials")).toBe(false);
    expect(hasModule(undefined, "materials")).toBe(false);
    expect(moduleOn(null, "materials")).toBe(true);
  });
  it("is true only for a module that is ON", () => {
    expect(hasModule({ modules: ["quotes", "materials"] }, "materials")).toBe(true);
    expect(hasModule({ modules: ["quotes"] }, "materials")).toBe(false);
  });
});
