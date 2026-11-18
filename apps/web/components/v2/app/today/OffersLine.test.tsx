import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OffersLine } from "./OffersLine";

describe("Today's offers line", () => {
  it("says how many wait and opens them", () => {
    render(<OffersLine line="2 offers are waiting for your approval" open="Review" href="/app/tenants/t/campaigns" />);
    expect(screen.getByText("2 offers are waiting for your approval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/app/tenants/t/campaigns");
  });
});
