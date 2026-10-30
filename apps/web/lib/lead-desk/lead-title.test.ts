import { describe, expect, it } from "vitest";

import { leadTitle, looksLikeId } from "./leads";

describe("the name a lead is shown with", () => {
  it("is the name, else the phone, else 'New enquiry'", () => {
    expect(leadTitle("Ravi K.", "+919876543210", "New enquiry")).toBe("Ravi K.");
    expect(leadTitle("", "+919876543210", "New enquiry")).toBe("+919876543210");
    expect(leadTitle(null, null, "New enquiry")).toBe("New enquiry");
    expect(leadTitle("  ", "  ", "New enquiry")).toBe("New enquiry");
  });
  it("never shows an internal id as a name", () => {
    for (const bad of ["3f2a9b1c-5d4e-4f6a-8b7c-9d0e1f2a3b4c", "3f2a9b1c5d4e", "Enquiry 8a297f", "WhatsApp customer 84407a", "Lead 3f2a9b1c", "contact_3f2a9b1c", "New lead #84407a"]) {
      expect(looksLikeId(bad)).toBe(true);
      expect(leadTitle(bad, "+919876543210", "New enquiry")).toBe("+919876543210");
      expect(leadTitle(bad, null, "New enquiry")).toBe("New enquiry");
    }
  });
  it("keeps real names, even ones that start with the same words", () => {
    for (const ok of ["Lead Anitha", "Customer Care Services", "Enquiry Desk Pvt Ltd", "Decade Textiles", "Facade Works", "Ravi 2"]) expect(looksLikeId(ok)).toBe(false);
  });
});
