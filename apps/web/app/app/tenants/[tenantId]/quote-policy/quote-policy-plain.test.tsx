import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { QuotePolicyForm } from "./quote-policy-form";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("qp.")));

describe("Quote rules as plain fields (SETTINGS_OPEN)", () => {
  it("labelled fields, ONE 'Save changes', one grey line about old quotes; no 'Publish a new version' wording, no sentence", () => {
    const { container } = render(<QuotePolicyForm plain action={vi.fn()} policyId="55555555-5555-4555-8555-555555555555" today="2026-10-08" minDate="2026-10-12" words={words} />);
    expect(screen.getByLabelText("Days a quote is valid")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Discount ceiling/)).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByText("Changes apply to new quotes only. Old quotes keep their rules.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Publish a new version|Publish this version/);
    expect(container.querySelector("form")?.className).not.toMatch(/rounded|border/);
  });
});
