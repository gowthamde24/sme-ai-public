import { describe, expect, it } from "vitest";

import { customerName } from "./NeedsYou";

const words = { "today.customer.unknown": "a customer", "today.customer.new": "New enquiry" };

describe("what a Needs-you card calls the customer (owner: never a placeholder)", () => {
  it("a name stays as it is", () => expect(customerName("Hegde Silks and Sarees", words)).toBe("Hegde Silks and Sarees"));
  it("an internal placeholder or an id reads 'New enquiry'", () => {
    for (const p of ["Enquiry 92e730", "WhatsApp customer 84407a", "3f2a9b1c-1111-4222-8333-444455556666"]) expect(customerName(p, words)).toBe("New enquiry");
  });
  it("nothing at all reads 'a customer'", () => {
    expect(customerName("", words)).toBe("a customer");
    expect(customerName(null, words)).toBe("a customer");
  });
});
