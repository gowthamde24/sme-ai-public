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
  it("is ONE card: where the test screen is on, the page shows only the panel (it carries the state), never a second state card", () => {
    show(NOTHING);
    expect(screen.getByRole("heading", { level: 1, name: "Phone numbers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(document.querySelector('[data-part="phone-status"]')).toBeNull();
    expect(document.querySelector('[data-part="empty-next"]')).toBeNull();
    expect(document.querySelector('[data-part="change-voice"]')).toBeNull();
  });
  it("where the test screen is off the page says the state once, in the grey status, and shows its next step", () => {
    show(null);
    expect(document.querySelector('[data-part="phone-status"] [data-status="no_answer"]')).toHaveTextContent("Not set up yet");
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(screen.getByRole("link", { name: "Use your WhatsApp number for now" })).toHaveAttribute("href", "/app/tenants/t1/integrations");
  });
});
