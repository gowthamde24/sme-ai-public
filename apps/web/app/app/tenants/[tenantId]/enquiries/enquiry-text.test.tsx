import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RequirementField } from "@/lib/api/enquiries";

import { EnquiryText } from "./enquiry-text";

function field(over: Partial<RequirementField>): RequirementField {
  return {
    id: "f1", line_no: 1, field_key: "quantity", value: { code: null, int_value: 20, date_value: null, text: null, basis: "piece" }, display: "20 pieces",
    certainty: "stated", state: "proposed", conflict: false, created_via: "agent", quote: "20", quote_start: 5, quote_end: 7, decided_by: null, decided_at: null, ...over,
  };
}

describe("EnquiryText", () => {
  it("marks the words a field cites, as text", () => {
    render(<EnquiryText body="Need 20 sarees" fields={[field({})]} />);
    const marked = document.querySelector("mark");
    expect(marked?.textContent).toBe("20");
    expect(marked?.getAttribute("title")).toBe("Cited by: Quantity");
    expect(screen.getByTestId("enquiry-text").textContent).toBe("Need 20 sarees");
  });

  it("renders hostile text as TEXT: no element, no attribute, no link is built from it", () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)> <a href="https://evil.test">click</a> javascript:alert(3)';
    const body = `Need 20 sarees ${hostile}`;
    const { container } = render(<EnquiryText body={body} fields={[field({ quote_start: 15, quote_end: 15 + hostile.length })]} />);
    expect(container.querySelector("script, img, a, iframe, svg")).toBeNull();
    expect(screen.getByTestId("enquiry-text").textContent).toBe(body);
    expect(container.querySelector("mark")?.textContent).toBe(hostile);
  });

  it("does not mark a rejected field's quote and keeps line breaks and wrapping", () => {
    render(<EnquiryText body={"Line one\nLine two"} fields={[field({ state: "rejected", quote_start: 0, quote_end: 4 })]} />);
    expect(document.querySelector("mark")).toBeNull();
    expect(screen.getByTestId("enquiry-text")).toHaveClass("plain-text");
    expect(screen.getByTestId("enquiry-text").textContent).toBe("Line one\nLine two");
  });

  it("a manual field has no quote and marks nothing", () => {
    render(<EnquiryText body="Need 20 sarees" fields={[field({ quote: null, quote_start: null, quote_end: null, created_via: "manual" })]} />);
    expect(document.querySelector("mark")).toBeNull();
  });
});
