import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_NUMBER, NOTHING, type PhoneNumber } from "@/lib/phone-number/types";

import { PhoneNumberPanel, type PhoneActions } from "./PhoneNumberPanel";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("phone.") || k === "today.act.cancel"));
const PENDING: PhoneNumber = { state: "kyc_pending", city: "chennai", number: MOCK_NUMBER.chennai, done: [] };
const ACTIVE: PhoneNumber = { state: "active", city: "chennai", number: MOCK_NUMBER.chennai, done: ["business_proof", "owner_id"] };
const acts = (over: Partial<PhoneActions> = {}): PhoneActions => ({
  request: vi.fn(async () => ({ ok: true as const, data: PENDING })),
  approve: vi.fn(async () => ({ ok: true as const, data: { ...PENDING, done: ["business_proof" as const] } })),
  release: vi.fn(async () => ({ ok: true as const, data: NOTHING, message: "The number was given back." })),
  ...over,
});
const draw = (initial: PhoneNumber, { canEdit = true, mock = true, actions = acts() } = {}) => {
  render(<PhoneNumberPanel words={WORDS} initial={initial} canEdit={canEdit} mock={mock} actions={actions} />);
  return actions;
};
afterEach(cleanup);

describe("Settings > Phone number (the test screen)", () => {
  it("not set up: four cities, the price line, one button; the city picked is the one asked for", async () => {
    const a = draw(NOTHING);
    expect(screen.getByText(/Test screen: the numbers are made up/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Pick a city for your number" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Hyderabad", "Bengaluru", "Chennai", "Mumbai"]);
    expect(document.querySelector('[data-part="phone-cost"]')).toHaveTextContent("You will see the price and say yes before anything is bought.");
    fireEvent.click(screen.getByRole("button", { name: "Chennai" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Get a number" })));
    expect(a.request).toHaveBeenCalledWith("chennai");
    expect(document.querySelector('[data-part="phone-digits"]')).toHaveTextContent(MOCK_NUMBER.chennai);
    expect(document.querySelector("[data-phone-state]")).toHaveAttribute("data-phone-state", "kyc_pending");
  });

  it("waiting: the two steps, 'Example: mark as approved' only on the test screen; a step approved moves on", async () => {
    const a = draw(PENDING);
    const first = document.querySelector('[data-step="business_proof"]') as HTMLElement;
    await act(async () => void fireEvent.click(within(first).getByRole("button", { name: "Example: mark as approved" })));
    expect(a.approve).toHaveBeenCalledWith("business_proof");
    expect(within(document.querySelector('[data-step="business_proof"]') as HTMLElement).getByText("Approved")).toBeInTheDocument();
    cleanup();
    draw(PENDING, { mock: false });
    expect(screen.queryByRole("button", { name: "Example: mark as approved" })).toBeNull();
  });

  it("active: the number, a test ring that says nothing was rung, and giving it back needs a second yes", async () => {
    const a = draw(ACTIVE);
    fireEvent.click(screen.getByRole("button", { name: "Ring my phone to test" }));
    expect(screen.getByRole("status")).toHaveTextContent("Example only: nothing was rung.");
    fireEvent.click(screen.getByRole("button", { name: "Give this number back" }));
    expect(a.release).not.toHaveBeenCalled();
    expect(screen.getByText("Calls to this number will stop working.")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Yes, give it back" })));
    expect(a.release).toHaveBeenCalled();
    expect(screen.getByText("The number was given back.")).toBeInTheDocument();
    expect(document.querySelector("[data-phone-state]")).toHaveAttribute("data-phone-state", "not_set_up");
  });

  it("a refusal is shown and the state stays; someone who is not the owner sees the state but no button", async () => {
    draw(NOTHING, { actions: acts({ request: vi.fn(async () => ({ ok: false as const, error: "Only the owner changes this." })) }) });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Get a number" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Only the owner changes this.");
    cleanup();
    draw(PENDING, { canEdit: false });
    expect(screen.queryByRole("button", { name: /Give this number back|Example/ })).toBeNull();
    expect(screen.getByText("Only the owner changes this.")).toBeInTheDocument();
  });
});
