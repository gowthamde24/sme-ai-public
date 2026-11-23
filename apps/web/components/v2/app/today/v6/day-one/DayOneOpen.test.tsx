import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { appDict } from "@/i18n/app";

import DayOne, { type DayOneActions } from "./DayOne";
import { stepViews } from "./steps";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("tv6.") || k.startsWith("dst.")));
const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const actions = (): DayOneActions => ({ skip: vi.fn(async () => undefined), goLive: vi.fn(async () => ({ ok: true, missing: [] })), testNumber: null });
const view = (done: Parameters<typeof stepViews>[0], canGoLive = false) => (
  <DayOne open name="Gowtham" steps={stepViews(done, BASE)} canGoLive={canGoLive} missing={[]} actions={actions()} words={WORDS} language="English" helpHref="/help" testCallHref={`${BASE}/calls`} />
);
afterEach(cleanup);

describe("First day, the open layout (FIRST_DAY_OPEN)", () => {
  it("is one title, a Skip link, a thin progress line and seven hairline rows: no ring, no cards, no 'Continue setup' button", () => {
    const { container } = render(view({ shop: true }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gowtham");
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1 of 7 done")).toBeInTheDocument();
    expect(container.querySelector('[data-part="progress-ring"]')).toBeNull();
    expect(screen.queryByText(/Continue setup/)).toBeNull();
    expect(container.querySelectorAll('[data-part="steps"] > li')).toHaveLength(7);
    expect(container.innerHTML).not.toMatch(/rounded-\[2|shadow-|gradient|ds-do/);
  });
  it("the CURRENT step is the only one with the orange Start button; the others show a grey time; a done step is grey with a tick", () => {
    const { container } = render(view({ shop: true }));
    const rows = [...container.querySelectorAll('[data-part="steps"] > li')] as HTMLElement[];
    expect(rows[0]).toHaveAttribute("data-state", "done");
    expect(rows[1]).toHaveAttribute("data-state", "current");
    expect(screen.getAllByRole("link", { name: "Start →" })).toHaveLength(1);
    expect(within(rows[1]).getByRole("link", { name: "Start →" })).toBeInTheDocument();
    expect(within(rows[2]).getByText("2 min")).toBeInTheDocument();
  });
  it("names the second step 'Add what you sell'", () => {
    render(view({ shop: true }));
    expect(screen.getByRole("link", { name: "Add what you sell" })).toBeInTheDocument();
  });
  it("shows 'Go live' only when the last step is done (not before, even if it could go live)", () => {
    const { container, rerender } = render(view({ shop: true }, true));
    expect(container.querySelector('[data-part="go-live"]')).toBeNull();
    rerender(view({ shop: true, catalogue: true, speaks: true, rules: true, practise: true, phone: true, sources: true }, true));
    expect(container.querySelector('[data-part="go-live"]')).not.toBeNull();
  });
});
