import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { CampaignOverview } from "./CampaignOverview";

const words = appDict("en") as Record<string, string>;
const campaign = { id: "33333333-3333-3333-3333-333333333333", status: "approved", issues: [], issue_text: {}, message_text: "Hello", language: "en", steps: [{ offset_days: 0, time: "10:00" }], call_after_step: null, call_wait_hours: 0 } as never;
const draw = (calls: { overridden: readonly string[] } | null) => render(<CampaignOverview base="/app/tenants/t" campaign={campaign} words={words} canEdit calls={calls} />);
afterEach(cleanup);

describe("the campaign's call settings card (job DQ part 3)", () => {
  it("is not drawn unless the page passes it (call settings off, or not Owner/Admin)", () => {
    draw(null);
    expect(document.querySelector("[data-part='campaign-calls']")).toBeNull();
  });
  it("says it follows the assistant's settings, and links to the campaign's own call-settings page", () => {
    draw({ overridden: [] });
    const card = document.querySelector("[data-part='campaign-calls']") as HTMLElement;
    expect(card).toHaveTextContent(words["calls.c.same"]);
    expect(card.querySelector("a")).toHaveAttribute("href", "/app/tenants/t/campaigns/33333333-3333-3333-3333-333333333333/call-settings");
  });
  it("names the fields that differ in plain words", () => {
    draw({ overridden: ["concurrent_calls", "keywords"] });
    expect(screen.getByText(`Different here: ${words["calls.f.concurrent_calls"]}, ${words["calls.f.keywords"]}.`)).toBeInTheDocument();
  });
});
