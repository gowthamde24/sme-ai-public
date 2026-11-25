import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ permanentRedirect: (to: string) => redirect(to) }));

import RefundPolicyPage from "./page";

describe("/refund-policy: one refund page, /refunds", () => {
  it("leads to /refunds for good, whatever the flag says", () => {
    expect(() => RefundPolicyPage()).toThrow("REDIRECT /refunds");
    expect(redirect).toHaveBeenCalledWith("/refunds");
  });
});
