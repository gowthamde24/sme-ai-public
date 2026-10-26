import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { Consents, GrievanceResult, MarketingResult } from "@/lib/dpdp/types";

import { GrievanceForm } from "./GrievanceForm";
import { MarketingSwitch } from "./MarketingSwitch";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("dpdp.") || k === "frame.notyet")) as Record<string, string>;
const consents = (state: Consents["marketing"]["state"], history: Consents["history"] = []): Consents => ({ noticeVersion: "2026-10-27", marketing: { state, since: state === "not_given" ? null : "2026-10-20T05:00:00Z" }, history });

describe("Settings > Privacy and data > News and offers (job DQ part 2)", () => {
  it("is OFF until the person turns it on: the switch is not on, and it says nothing is sent", () => {
    render(<MarketingSwitch words={words} lang="en" initial={consents("not_given")} action={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: /news and offers/i });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("You have not said yes, so we send none.")).toBeInTheDocument();
    expect(screen.getByText(/nothing depends on it/)).toBeInTheDocument();
  });
  it("one switch gives and withdraws: it asks the action for the OTHER state and shows the answer, at once", async () => {
    const action = vi.fn(async (given: boolean): Promise<MarketingResult> => ({ ok: true, consents: consents(given ? "given" : "withdrawn", [{ action: given ? "given" : "withdrawn", at: "2026-10-27T05:00:00Z", via: "settings", noticeVersion: "2026-10-27" }]) }));
    render(<MarketingSwitch words={words} lang="en" initial={consents("not_given")} action={action} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    expect(action).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Switched on. We may send you news and offers.")).toBeInTheDocument();
    expect(screen.getByText(/You said yes on/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
    expect(action).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("Switched off. We have stopped.")).toBeInTheDocument();
    expect(screen.getByText(/You switched this off on/)).toBeInTheDocument();
  });
  it("a failed change leaves the switch where it was and says nothing was changed", async () => {
    render(<MarketingSwitch words={words} lang="en" initial={consents("given")} action={vi.fn(async () => ({ ok: false as const, error: "down" as const }))} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByText("That did not save. Nothing was changed. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
  it("lists the earlier choices with the way each was made (at sign-up, with Google, in Settings)", () => {
    render(
      <MarketingSwitch
        words={words}
        lang="en"
        initial={consents("withdrawn", [
          { action: "withdrawn", at: "2026-10-20T05:00:00Z", via: "settings", noticeVersion: "2026-10-27" },
          { action: "given", at: "2026-10-01T05:00:00Z", via: "google", noticeVersion: "2026-10-27" },
        ])}
        action={vi.fn()}
      />,
    );
    const items = within(screen.getByText("Your earlier choices").parentElement!).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/Switched off \(in Settings\)/);
    expect(items[1]).toMatch(/Said yes \(with Google sign-in\)/);
  });
});

describe("Settings > Privacy and data > Raise a grievance (job DQ part 2)", () => {
  const draw = (action: (input: unknown) => Promise<GrievanceResult>) => render(<GrievanceForm words={words} lang="hi" action={action} defaults={{ name: "Lakshmi", contact: "lakshmi@shop.example" }} days={30} email="privacy@stack19.com" />);
  it("says the answer time and the address, is filled from the account, and offers the six kinds", () => {
    draw(vi.fn());
    expect(screen.getByText(/answer within 30 days. You can also write to privacy@stack19.com/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveValue("Lakshmi");
    expect(screen.getByLabelText("Your e-mail address or phone number")).toHaveValue("lakshmi@shop.example");
    expect(within(screen.getByLabelText("What is it about?")).getAllByRole("option").map((o) => o.textContent)).toEqual(["See my data", "Correct my data", "Erase my data", "Withdraw my consent", "A complaint", "Something else"]);
  });
  it("sends what was typed with the page's language, then shows the receipt (the reference, the day, the Board) in place of the form", async () => {
    const action = vi.fn(async (): Promise<GrievanceResult> => ({ ok: true, reference: "GR-2026-000123", answerDueOn: "2026-11-26", answerWithinDays: 30 }));
    draw(action);
    fireEvent.change(screen.getByLabelText("What is it about?"), { target: { value: "erasure" } });
    fireEvent.change(screen.getByLabelText("What happened (optional)"), { target: { value: "Please erase my number." } });
    fireEvent.click(screen.getByRole("button", { name: "Send my grievance" }));
    expect(await screen.findByText("Your reference is GR-2026-000123. We will answer by 2026-11-26.")).toBeInTheDocument();
    expect(action).toHaveBeenCalledWith({ name: "Lakshmi", contact: "lakshmi@shop.example", kind: "erasure", details: "Please erase my number.", language: "hi" });
    expect(screen.getByText("We have it.")).toBeInTheDocument();
    expect(screen.getByText(/Data Protection Board of India/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send my grievance" })).toBeNull();
  });
  it.each([["name", "Type your name."], ["contact", "Give an e-mail address or a phone number."], ["rate", "Too many tries. Wait a little and try again."], ["down", "That did not send. Write to privacy@stack19.com instead."], ["invalid", "Check the form and try again."]] as const)("a refusal '%s' is said, and the form stays so nothing typed is lost", async (error, text) => {
    draw(vi.fn(async () => ({ ok: false as const, error })));
    fireEvent.click(screen.getByRole("button", { name: "Send my grievance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Your name")).toHaveValue("Lakshmi");
  });
});
