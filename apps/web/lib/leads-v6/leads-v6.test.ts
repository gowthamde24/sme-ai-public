import { describe, expect, it } from "vitest";

import { STATUSES } from "@/components/v2/app/ds/StatusPill";
import type { DeskLead } from "@/lib/lead-desk/leads";
import type { Prospect } from "@/lib/lead-finder/types";

import { CHIP_STATUS, LEAD_CHIPS, chipCounts, isLeadChip, leadChip, prospectChip } from "./chips";
import { rowFromLead, rowFromProspect, searchRows, signalsFromVisits, sortRows } from "./rows";

const lead = (over: Partial<DeskLead> = {}): DeskLead => ({ id: "l1", contactId: null, name: "Ravi K.", source: "indiamart", status: "new", ownerUserId: null, createdAt: "2026-11-12T05:00:00Z", hot: false, ...over });

describe("the six chips", () => {
  it("are New, Contacted, Visit booked, Quote, Won, Lost, each on one of the design system's status colours", () => {
    expect(LEAD_CHIPS).toEqual(["new", "contacted", "visit_booked", "quote", "won", "lost"]);
    for (const c of LEAD_CHIPS) expect(STATUSES).toContain(CHIP_STATUS[c]);
    expect(new Set(LEAD_CHIPS.map((c) => CHIP_STATUS[c])).size).toBe(6);
    expect(isLeadChip("won")).toBe(true);
    expect(isLeadChip("hot")).toBe(false);
  });
  it("maps the CRM states", () => {
    expect(leadChip("new")).toBe("new");
    expect(leadChip("contacted")).toBe("contacted");
    expect(leadChip("qualified")).toBe("contacted");
    expect(leadChip("disqualified")).toBe("lost");
  });
  it("lets what happened last win: a purchase, a quote, a booked visit", () => {
    expect(leadChip("contacted", { visitBooked: true })).toBe("visit_booked");
    expect(leadChip("contacted", { visitBooked: true, quoted: true })).toBe("quote");
    expect(leadChip("qualified", { visitBooked: true, quoted: true, won: true })).toBe("won");
    expect(leadChip("disqualified", { won: true })).toBe("won");
    expect(leadChip("disqualified", { visitBooked: true })).toBe("lost");
  });
  it("maps the businesses the Lead Finder found", () => {
    expect(prospectChip("needs_owner")).toBe("new");
    expect(prospectChip("call_ready")).toBe("new");
    expect(prospectChip("contacted")).toBe("contacted");
    expect(prospectChip("qualified")).toBe("contacted");
    expect(prospectChip("skipped")).toBe("lost");
    expect(prospectChip("not_interested")).toBe("lost");
  });
  it("counts each chip and the total", () => {
    expect(chipCounts([{ chip: "new" }, { chip: "new" }, { chip: "won" }])).toEqual({ all: 3, new: 2, contacted: 0, visit_booked: 0, quote: 0, won: 1, lost: 0 });
  });
});

describe("the rows", () => {
  it("builds a lead row: the name, what it wants and where, its chip and the open key", () => {
    const row = rowFromLead(lead({ profile: { need: "Paver blocks", quantity: "2000 sq ft", area: "Gandhi Nagar", city: "Guntur" } as never, hot: true }), { visitBooked: true }, "New enquiry");
    expect(row).toMatchObject({ key: "l-l1", kind: "lead", name: "Ravi K.", chip: "visit_booked", source: "indiamart", nearby: false, line: "Paver blocks · 2000 sq ft · Gandhi Nagar", hot: true });
  });
  it("never shows an id as a name", () => {
    expect(rowFromLead(lead({ name: "Lead 3f2a9b1c" }), {}, "New enquiry").name).toBe("New enquiry");
  });
  it("builds a found-nearby row with no lead source", () => {
    const p = { id: "p1", name: null, category: "retailer", area: "Jayanagar", phone: null, status: "needs_owner", createdAt: "2026-11-12T06:00:00Z" } as unknown as Prospect;
    expect(rowFromProspect(p, "Details unavailable")).toMatchObject({ key: "p-p1", kind: "found", nearby: true, source: null, name: "Details unavailable", chip: "new", line: "retailer · Jayanagar" });
  });
  it("sorts newest first and searches name, words and phone", () => {
    const a = rowFromLead(lead({ id: "a", name: "Anitha", createdAt: "2026-11-10T00:00:00Z" }), {}, "x");
    const b = rowFromLead(lead({ id: "b", name: "Bharat", createdAt: "2026-11-12T00:00:00Z", phone: "98000 11111" }), {}, "x");
    expect(sortRows([a, b]).map((r) => r.id)).toEqual(["b", "a"]);
    expect(searchRows([a, b], "  bha ").map((r) => r.id)).toEqual(["b"]);
    expect(searchRows([a, b], "11111").map((r) => r.id)).toEqual(["b"]);
    expect(searchRows([a, b], "").length).toBe(2);
  });
  it("reads the chips a visit tells", () => {
    const s = signalsFromVisits([
      { lead_id: "a", status: "booked", outcome: null },
      { lead_id: "b", status: "completed", outcome: "bought" },
      { lead_id: "c", status: "cancelled", outcome: null },
      { lead_id: "d", status: "no_show", outcome: null },
    ]);
    expect(s.get("a")).toEqual({ visitBooked: true });
    expect(s.get("b")).toEqual({ visitBooked: true, won: true });
    expect(s.has("c")).toBe(false);
    expect(s.has("d")).toBe(false);
  });
});
