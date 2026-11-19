import { describe, expect, it } from "vitest";

import { CATALOGUE } from "./catalogue";
import { PLAN_NAMES, planName } from "./names";

describe("owner-facing plan names (one place)", () => {
  it("maps the API's plan ids to Pay as you go / Pro / Business, and nothing else", () => {
    expect(PLAN_NAMES).toEqual({ calls_payg: "Pay as you go", calls_300: "Pro", calls_1000: "Business", payg: "Pay as you go", sales_assistant: "Pro", sales_lead_finder: "Business" });
  });
  it("an id with no owner-facing name shows the API's own name; no id and no name is null", () => {
    expect(planName("starter", "Starter")).toBe("Starter");
    expect(planName("something_new", null)).toBeNull();
    expect(planName(null)).toBeNull();
    expect(planName("toString", "x")).toBe("x");
  });
  it("the catalogue the screens read never carries the retired names", () => {
    const names = CATALOGUE.plans.map((p) => p.name);
    for (const n of names) expect(n).not.toMatch(/lead desk|workforce/i);
  });
});
