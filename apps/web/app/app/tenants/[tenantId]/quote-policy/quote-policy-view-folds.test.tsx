import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QuotePolicyVersion } from "@/lib/api/quote-policies";

import { QuotePolicyView } from "./quote-policy-view";

// Every number in this file is a SYNTHETIC placeholder for a test, not the family's policy.
const TODAY = "2026-10-08";
const base: QuotePolicyVersion = {
  id: "55555555-5555-4555-8555-555555555555", version_no: 3, effective_from: "2026-10-01", discount_ceiling_bps: 0, shipping_flat_fee_paise: 0, shipping_free_above_paise: null, shipping_tax_bps: 0,
  validity_days: 7, new_advance_bps: 5000, repeat_advance_bps: 2550, new_net_days: 10, repeat_net_days: 45, gst_rate_bps: 500, gst_effective_from: "2026-10-01", tax_mode: "exclusive",
  rounding_mode: "half_up", repeat_credit_limit_paise: 250_050, seller_state: "XX", required_inputs: ["delivery_state"], created_at: "2026-10-01T10:00:00.000000+00:00", in_force: true,
};
const v = (over: Partial<QuotePolicyVersion>): QuotePolicyVersion => ({ ...base, ...over });

describe("QuotePolicyView: earlier versions are folded away", () => {
  it("shows the version in force and the ones not started yet; the replaced ones wait behind 'Earlier versions (n)' (still in the page, closed)", () => {
    const versions = [v({ id: "66666666-6666-4666-8666-666666666666", version_no: 4, effective_from: "2026-11-01", in_force: false }), v({}), v({ id: "77777777-7777-4777-8777-777777777777", version_no: 2, effective_from: "2026-09-01", in_force: false }), v({ id: "88888888-8888-4888-8888-888888888888", version_no: 1, effective_from: "2026-08-01", in_force: false })];
    render(<QuotePolicyView versions={versions} today={TODAY} form={<p>THE-FORM</p>} />);
    const main = within(screen.getByRole("list", { name: "Quote policy versions, newest first" }));
    expect(main.getAllByRole("listitem")).toHaveLength(2);
    expect(main.getByText(/Version 4/)).toBeInTheDocument();
    expect(main.getByText(/Version 3/)).toBeInTheDocument();
    const summary = screen.getByText("Earlier versions (2)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(within(summary.closest("details") as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  });
  it("one version, or none in force: the newest is still shown, and there is no fold when nothing is left", () => {
    render(<QuotePolicyView versions={[v({ in_force: false, effective_from: "2026-09-01" })]} today={TODAY} form={null} />);
    expect(screen.getByText(/Version 3/)).toBeInTheDocument();
    expect(screen.queryByText(/Earlier versions/)).toBeNull();
  });
});
