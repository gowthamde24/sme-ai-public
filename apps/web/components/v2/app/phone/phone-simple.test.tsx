import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// the lazy chunk is drawn at once in a unit test
vi.mock("./LazyPhoneGetSimple", async () => ({ PhoneGetSimple: (await import("./PhoneGetSimple")).PhoneGetSimple }));

import { appDict } from "@/i18n/app";
import { MOCK_NUMBER, NOTHING, type PhoneNumber } from "@/lib/phone-number/types";

import { PhoneNumberPanel, type PhoneActions } from "./PhoneNumberPanel";

const dict = appDict("en") as Record<string, string>;
const WORDS = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("phone.") || k.startsWith("phv6.") || k.startsWith("jobs.pg.phone.") || k === "today.act.cancel"));
const PENDING: PhoneNumber = { state: "kyc_pending", city: "chennai", number: MOCK_NUMBER.chennai, done: [] };
const acts = (): PhoneActions => ({
  request: vi.fn(async () => ({ ok: true as const, data: PENDING })),
  approve: vi.fn(async () => ({ ok: true as const, data: PENDING })),
  release: vi.fn(async () => ({ ok: true as const, data: NOTHING })),
});
afterEach(cleanup);
const said = (el: Element | null): string => {
  const clone = el!.cloneNode(true) as HTMLElement;
  const live = Array.from(el!.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((sel, i) => sel.replaceWith(document.createTextNode(live[i].selectedOptions[0]?.textContent ?? "")));
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
};
const draw = (props: { canEdit?: boolean; simple?: boolean; initial?: PhoneNumber } = {}) => {
  const actions = acts();
  render(<PhoneNumberPanel words={WORDS} initial={props.initial ?? NOTHING} canEdit={props.canEdit ?? true} mock actions={actions} single showMock={false} simple={props.simple ?? true} />);
  return actions;
};

describe("Get a number as a sentence (JOBS)", () => {
  it("says 'Get a number in Hyderabad.', what it costs (no price made up), what happens next and ONE button", () => {
    draw();
    expect(said(document.querySelector('[data-setting-line="phone-city"]'))).toBe("Get a number in Hyderabad.");
    expect(document.querySelector('[data-part="phone-cost"]')).toHaveTextContent("A business number costs money every month. You will see the price and say yes before anything is bought.");
    expect(document.querySelector('[data-part="phone-cost"]')?.textContent).not.toMatch(/₹/);
    expect(document.querySelector('[data-part="phone-effect"]')).toHaveTextContent("What happens next: Your assistant gets a Hyderabad number. It starts calling only after your business registration is approved.");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(Array.from((screen.getByLabelText("Pick a city for your number") as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Hyderabad", "Bengaluru", "Chennai", "Mumbai"]);
  });

  it("the city picked is the city asked for (the same request as the chips and the button of before)", async () => {
    const a = draw();
    fireEvent.change(screen.getByLabelText("Pick a city for your number"), { target: { value: "chennai" } });
    expect(document.querySelector('[data-part="phone-effect"]')).toHaveTextContent("Your assistant gets a Chennai number.");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Get a number" })));
    expect(a.request).toHaveBeenCalledWith("chennai");
    expect(document.querySelector('[data-phone-state]')).toHaveAttribute("data-phone-state", "kyc_pending");
  });

  it("only the owner changes it: the city is read-only and there is no button for anyone else", () => {
    draw({ canEdit: false });
    expect(screen.getByLabelText("Pick a city for your number")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Get a number" })).toBeNull();
    expect(screen.getByText("Only the owner changes this.")).toBeInTheDocument();
  });

  it("JOBS off: the four city chips are drawn as before", () => {
    draw({ simple: false });
    expect(screen.getByRole("group", { name: "Pick a city for your number" })).toBeInTheDocument();
    expect(document.querySelector("[data-simple]")).toBeNull();
  });

  it("the other states (waiting for approval) are the same under JOBS", () => {
    draw({ initial: PENDING });
    expect(document.querySelector('[data-part="phone-kyc"]')).not.toBeNull();
    expect(document.querySelector('[data-part="phone-pick"]')).toBeNull();
  });
});
