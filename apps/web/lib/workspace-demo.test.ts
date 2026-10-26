import { describe, expect, it } from "vitest";

import { parseAccess } from "@/lib/api/billing-access";

import { isDemoWorkspace } from "./workspace-demo";

describe("is this a demo workspace?", () => {
  it("the API's own word wins over the name, both ways", () => {
    expect(isDemoWorkspace("Acme Silks", true)).toBe(true);
    expect(isDemoWorkspace("DEMO Silks (synthetic)", false)).toBe(false);
  });
  it("without the API's word (not deployed yet) the name 'DEMO ...' is the hint", () => {
    expect(isDemoWorkspace("DEMO Silks (synthetic)")).toBe(true);
    expect(isDemoWorkspace("DEMO Silks (synthetic)", null)).toBe(true);
    expect(isDemoWorkspace("Demonstration Traders")).toBe(false);
    expect(isDemoWorkspace(null)).toBe(false);
  });
  it("billing/access carries demo for every member, read-only or not; absent stays absent", () => {
    expect(parseAccess({ access: "full", demo: true, exempt: true })).toEqual({ readOnly: false, demo: true });
    expect(parseAccess({ access: "full" })).toEqual({ readOnly: false });
    expect(parseAccess({ access: "read_only", demo: false, read_only_since: "2026-10-01", delete_on: "2027-01-01", data_days_left: 70 })).toMatchObject({ readOnly: true, demo: false });
    expect(parseAccess({ access: "full", demo: "yes" })).toEqual({ readOnly: false });
  });
});
