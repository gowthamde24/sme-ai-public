import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QuotePolicyVersion } from "@/lib/api/quote-policies";

import { QuotePolicyView } from "./quote-policy-view";

// Every number in this file is a SYNTHETIC placeholder for a test, not the family's policy.
const TODAY = "2026-10-08";
const base: QuotePolicyVersion = {
  id: "55555555-5555-4555-8555-555555555555",
  version_no: 2,
  effective_from: "2026-10-01",
  discount_ceiling_bps: 0,
  shipping_flat_fee_paise: 0,
  shipping_free_above_paise: null,
  shipping_tax_bps: 0,
  validity_days: 7,
  new_advance_bps: 5000,
  repeat_advance_bps: 2550,
  net_days: 30,
  tax_mode: "exclusive",
  rounding_mode: "half_up",
  repeat_credit_limit_paise: 250_050,
  seller_state: "XX",
  required_inputs: ["delivery_state"],
  created_at: "2026-10-01T10:00:00.000000+00:00",
  in_force: true,
};
const v = (over: Partial<QuotePolicyVersion>): QuotePolicyVersion => ({ ...base, ...over });
const FORM = <p>THE-FORM</p>;
const ID3 = "77777777-7777-4777-8777-777777777777";
const ID1 = "88888888-8888-4888-8888-888888888888";

describe("QuotePolicyView: the versions", () => {
  it("lists the versions newest first, as the API gave them, and marks the one in force", () => {
    render(
      <QuotePolicyView
        today={TODAY}
        form={FORM}
        versions={[v({ id: ID3, version_no: 3, effective_from: "2026-10-20", in_force: false }), base, v({ id: ID1, version_no: 1, effective_from: "2026-09-01", in_force: false })]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.match(/Version \d/)?.[0])).toEqual(["Version 3", "Version 2", "Version 1"]);
    expect(within(items[0]).getByText(/not started yet/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/in force today/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/replaced by a newer version/)).toBeInTheDocument();
    expect(screen.getAllByText(/in force today/)).toHaveLength(1);
  });
  it("the marker is the API's, not worked out from dates", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[v({ in_force: false, effective_from: "2026-10-01" })]} />);
    expect(screen.queryByText(/in force today/)).toBeNull();
    expect(screen.getByText(/replaced by a newer version/)).toBeInTheDocument();
  });
  it("shows each figure in plain words: days, percents, rupees with Indian grouping, the state, the shipping", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[base]} />);
    const dl = screen.getByRole("listitem");
    const text = dl.textContent ?? "";
    expect(text).toContain("starts 1 Oct 2026");
    for (const [term, value] of [
      ["Days a quote is valid", "7"],
      ["Advance, new customer", "50%"],
      ["Advance, repeat customer", "25.5%"],
      ["Days of credit", "30"],
      ["Most credit for one repeat customer", "₹2,500.50"],
      ["State where the shop is", "XX"],
      ["Discount ceiling", "0%"],
      ["Shipping", "none (no courier charge)"],
    ] as const) {
      const dt = within(dl).getByText(term, { selector: "dt" });
      expect(dt.nextElementSibling?.textContent, term).toBe(value);
    }
  });
  it("an older version that does carry a shipping fee shows it as stored", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[v({ shipping_flat_fee_paise: 5000, shipping_tax_bps: 1800, shipping_free_above_paise: 1_000_000 })]} />);
    expect(screen.getByText("flat fee ₹50.00, tax 18%, free above ₹10,000.00")).toBeInTheDocument();
  });
  it("shows when each version was published, and shows no person, number or address", () => {
    const { container } = render(<QuotePolicyView today={TODAY} form={FORM} versions={[base]} />);
    expect(container.textContent).toMatch(/Published /);
    expect(container.textContent).not.toMatch(/@|\+\d{2}|\d{10}/);
  });
  it("renders the form it is given, after the list", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[base]} />);
    const list = screen.getByRole("list");
    const form = screen.getByText("THE-FORM");
    expect(list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("QuotePolicyView: when no policy is in force", () => {
  const SENTENCE = "No quote policy is in force. Until an owner or an admin publishes one, a quote cannot be made (a manual quote would be refused).";
  it("an empty list says so in a clear sentence, shows no list, and still shows the form", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[]} />);
    expect(screen.getByRole("note")).toHaveTextContent(SENTENCE);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("THE-FORM")).toBeInTheDocument();
  });
  it("versions that have all not started yet give the same sentence and the first start date", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[v({ id: ID3, version_no: 3, effective_from: "2026-11-20", in_force: false }), v({ id: ID1, version_no: 1, effective_from: "2026-10-20", in_force: false })]} />);
    expect(screen.getByRole("note")).toHaveTextContent(`${SENTENCE} The first published version starts on 20 Oct 2026.`);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("with a version in force there is no such sentence", () => {
    render(<QuotePolicyView today={TODAY} form={FORM} versions={[base]} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
