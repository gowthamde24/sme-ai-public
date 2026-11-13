import { describe, expect, it } from "vitest";

import { parseLeadPage } from "./lead-desk";

const row = (status: string, id: string) => ({
  id,
  created_by: "cefbe796-a735-46a5-853e-88e0e03f67d4",
  created_via: "manual",
  created_at: "2026-11-13T04:10:00Z",
  updated_at: "2026-11-13T04:10:00Z",
  archived_at: null,
  company_id: "1991d1cc-ae1e-3a4b-5ecf-995f0df91c49",
  contact_id: "9e5e6a43-9e41-85bf-9e4f-1b4cc62f334d",
  owner_user_id: null,
  status,
  source: "indiamart",
  disqualified_reason: null,
  profile: { name: "Demo Customer", source: "indiamart" },
});

describe("the lead list answer", () => {
  it("reads every status the database holds (new, in_review, qualified, disqualified); in_review was missing and made the whole page unreadable", () => {
    const page = parseLeadPage({
      items: [row("new", "f1a0f0d4-14f0-477c-f622-e9e12726e5af"), row("in_review", "57a8fb64-b251-8ac7-d038-37ebf031ca08"), row("qualified", "eacc3b45-9a7d-455a-f29e-8034757b345c"), row("disqualified", "2a8d3c9e-1f64-4f0e-9a52-6a3b7c1d0e11")],
      next_cursor: null,
    });
    expect(page.rows.map((r) => r.status)).toEqual(["new", "in_review", "qualified", "disqualified"]);
  });
  it("still refuses a status nobody knows", () => {
    expect(() => parseLeadPage({ items: [row("won", "2a8d3c9e-1f64-4f0e-9a52-6a3b7c1d0e11")], next_cursor: null })).toThrow();
  });
});
