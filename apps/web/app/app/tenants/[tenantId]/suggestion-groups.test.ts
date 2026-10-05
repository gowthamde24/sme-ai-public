import { describe, expect, it } from "vitest";

import type { ClaimSuggestionOut } from "@/lib/api/agents";

import { groupClaims } from "./suggestion-groups";

const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";

let n = 0;
function claim(over: Partial<ClaimSuggestionOut>): ClaimSuggestionOut {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    company_id: C1,
    lead_id: null,
    predicate: "buyer_type",
    value: "wholesaler",
    confidence: "unverified",
    claim_confidence: "unverified",
    created_via: "agent",
    agent_run_id: "r",
    created_by: "u",
    created_at: `2026-10-0${(n % 8) + 1}T12:00:00+00:00`,
    review_state: "unreviewed",
    review_confidence: null,
    reviewed_by: null,
    reviewed_at: null,
    company_name: "Saree House",
    evidence: [],
    ...over,
  };
}

describe("groupClaims", () => {
  it("shows two different values for one company and predicate as ONE conflicting group", () => {
    const groups = groupClaims([claim({ value: "wholesaler" }), claim({ value: "consumer" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].conflicting).toBe(true);
    expect(groups[0].claims.map((c) => c.value).sort()).toEqual(["consumer", "wholesaler"]);
    expect(groups[0].company).toBe("Saree House");
  });

  it("two suggestions that agree are a group but not a conflict", () => {
    const groups = groupClaims([claim({ value: "wholesaler" }), claim({ value: "wholesaler" })]);
    expect(groups[0].conflicting).toBe(false);
  });

  it("an accepted claim stays in view beside an unreviewed one that disagrees; a rejected one is out", () => {
    const groups = groupClaims([
      claim({ value: "wholesaler", review_state: "accepted", review_confidence: "high" }),
      claim({ value: "consumer" }),
      claim({ value: "boutique", review_state: "rejected" }),
    ]);
    expect(groups[0].claims.map((c) => c.value).sort()).toEqual(["consumer", "wholesaler"]);
    expect(groups[0].conflicting).toBe(true);
  });

  it("a predicate with nothing unreviewed is not listed", () => {
    expect(groupClaims([claim({ review_state: "accepted" }), claim({ review_state: "rejected" })])).toEqual([]);
  });

  it("different companies and different predicates are different groups; a person's claim is ignored", () => {
    const groups = groupClaims([
      claim({ company_id: C1 }),
      claim({ company_id: C2, company_name: "Other" }),
      claim({ predicate: "size_band", value: "medium" }),
      claim({ created_via: "manual", review_state: "not_applicable" }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.claims.every((c) => c.created_via === "agent"))).toBe(true);
  });

  it("lists the group with the newest suggestion first", () => {
    const old = claim({ company_id: C1, created_at: "2026-01-01T00:00:00+00:00" });
    const fresh = claim({ company_id: C2, company_name: "Fresh", created_at: "2026-12-01T00:00:00+00:00" });
    expect(groupClaims([old, fresh]).map((g) => g.company)).toEqual(["Fresh", "Saree House"]);
  });
});
