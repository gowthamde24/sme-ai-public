import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { NOTHING, type PhoneNumber } from "@/lib/phone-number/types";

import { PhoneV6 } from "./PhoneV6";

afterEach(cleanup);
const WORDS = appDict("en") as Record<string, string>;
const show = (phone: PhoneNumber | null) =>
  render(<PhoneV6 words={WORDS} lang="en" title="Phone numbers" help={<button type="button">?</button>} phone={phone} panel={<div data-testid="panel">the test screen</div>} connectHref="/app/tenants/t1/integrations" />);

describe("Phone numbers (design system v6)", () => {
  it("says in plain words that no number is set up, in the grey status, with the test screen's panel below", () => {
    show(NOTHING);
    expect(screen.getByRole("heading", { level: 1, name: "Phone numbers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
    const card = document.querySelector('[data-part="phone-status"]') as HTMLElement;
    expect(card.querySelector('[data-status="no_answer"]')).toHaveTextContent("Not set up yet");
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(document.querySelector('[data-part="empty-next"]')).toBeNull();
  });
  it("shows the number and 'waiting for approval' in the orange status, then 'active' in green", () => {
    const { rerender } = render(<PhoneV6 words={WORDS} lang="en" title="Phone numbers" help={null} phone={{ state: "kyc_pending", city: "hyderabad", number: "+00 040 0000 0101", done: [] }} panel={null} connectHref="/x" />);
    expect(document.querySelector('[data-status="spam"]')).toHaveTextContent("Waiting for approval");
    expect(screen.getByText("+00 040 0000 0101")).toBeInTheDocument();
    rerender(<PhoneV6 words={WORDS} lang="en" title="Phone numbers" help={null} phone={{ state: "active", city: "hyderabad", number: "+00 040 0000 0101", done: ["business_proof", "owner_id"] }} panel={null} connectHref="/x" />);
    expect(document.querySelector('[data-status="completed"]')).toHaveTextContent("Active");
  });
  it("where the test screen is off the page shows its next step", () => {
    show(null);
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(screen.getByRole("link", { name: "Use your WhatsApp number for now" })).toHaveAttribute("href", "/app/tenants/t1/integrations");
  });
});
