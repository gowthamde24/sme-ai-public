import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseQuote } from "@/lib/api/quotes";
import { QUOTE_JSON } from "@/lib/api/quotes-fixtures";

import { QuoteView } from "../../../../app/app/tenants/[tenantId]/enquiries/quote-view";

describe("the GSTINs on a quote (job CC)", () => {
  it("shows the customer's and the shop's number when the quote has them, after the kind of customer", () => {
    render(<QuoteView quote={parseQuote({ ...QUOTE_JSON, customer_gstin: "29AAGCB7383J1Z4", shop_gstin: "27AAPFU0939F1ZV" })} stateName="Maharashtra" />);
    expect(screen.getByText("Customer GSTIN").nextElementSibling).toHaveTextContent("29AAGCB7383J1Z4");
    expect(screen.getByText("Our GSTIN").nextElementSibling).toHaveTextContent("27AAPFU0939F1ZV");
  });
  it("leaves the rows out when there are none (the quote's own text is untouched)", () => {
    render(<QuoteView quote={parseQuote(QUOTE_JSON)} stateName="Maharashtra" />);
    expect(screen.queryByText("Customer GSTIN")).toBeNull();
    expect(screen.queryByText("Our GSTIN")).toBeNull();
  });
});
