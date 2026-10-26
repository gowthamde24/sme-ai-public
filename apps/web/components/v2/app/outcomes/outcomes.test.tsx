import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";
import { mockOutcomes, mockTotals } from "@/lib/outcomes/mock";

import { OutcomesPanel } from "./OutcomesPanel";
import { OutcomesToday } from "./OutcomesToday";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("outcome") || k === "frame.notyet"));
const NOW = new Date("2026-10-25T12:00:00Z");
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("what happened after each call and follow-up (on a customer)", () => {
  const outcomes = mockOutcomes("lead-1", NOW);
  it("lists each one with its channel, the result, what kind it was and the reason, newest first", () => {
    render(<OutcomesPanel words={words} lang="en" outcomes={outcomes} correct={null} />);
    expect(screen.getByRole("heading", { name: "Outcomes" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(outcomes.length);
    expect(items[0]).toHaveAttribute("data-outcome", outcomes[0].result);
    expect(items[0]).toHaveTextContent(outcomes[0].reason ?? "");
    expect(items[0]).toHaveTextContent(/Call|WhatsApp follow-up/);
    expect(items[0]).toHaveTextContent(/Positive|Negative|Unclear/);
    expect(screen.queryByRole("button", { name: "Correct this" })).toBeNull(); // a person who may only read has no button
  });
  it("says 'Not available yet' when it cannot be read and 'No calls or follow-ups yet.' when there are none (never a guess)", () => {
    const { rerender } = render(<OutcomesPanel words={words} lang="en" outcomes={null} correct={null} />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    rerender(<OutcomesPanel words={words} lang="en" outcomes={[]} correct={null} />);
    expect(screen.getByText("No calls or follow-ups yet.")).toBeInTheDocument();
  });
  it("draws a reason as plain text, never as markup", () => {
    render(<OutcomesPanel words={words} lang="en" outcomes={[{ ...outcomes[0], reason: "<img src=x onerror=alert(1)> was happy" }]} correct={null} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
  it("lets the owner correct one: only the results' own categories are offered, saving asks the server and reads the screen again", async () => {
    const correct = vi.fn(async () => ({ ok: true as const }));
    render(<OutcomesPanel words={words} lang="en" outcomes={outcomes.slice(0, 1)} correct={correct} />);
    fireEvent.click(screen.getByRole("button", { name: "Correct this" }));
    const result = screen.getByLabelText("Result");
    fireEvent.change(result, { target: { value: "negative" } });
    const cats = within(screen.getByLabelText("What happened")).getAllByRole("option").map((o) => o.textContent);
    expect(cats).toEqual(["Not interested", "Wrong number", "Too costly"]);
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "too_costly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(correct).toHaveBeenCalledWith(outcomes[0].id, "negative", "too_costly"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("a correction the server refuses says so and stays open", async () => {
    render(<OutcomesPanel words={words} lang="en" outcomes={outcomes.slice(0, 1)} correct={async () => ({ ok: false, error: "not_available" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Correct this" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not save. Try again.");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Result")).toBeNull();
  });
  it("a corrected outcome says the owner corrected it", () => {
    render(<OutcomesPanel words={words} lang="en" outcomes={mockOutcomes("lead-1", NOW, { [outcomes[0].id]: ["negative", "too_costly"] })} correct={null} />);
    expect(screen.getByText("You corrected this.")).toBeInTheDocument();
  });
});

describe("today's totals on Today", () => {
  it("says '[N] positive · [N] not interested' and only mentions the unclear when there are some", () => {
    render(<OutcomesToday words={words} totals={{ positive: 7, negative: 3, unclear: 0, notInterested: 3 }} />);
    const line = document.querySelector("[data-totals]")!;
    expect(line.textContent).toBe("7 positive·3 not interested");
    expect(screen.getByRole("heading", { name: "Outcomes today" })).toBeInTheDocument();
    cleanup();
    render(<OutcomesToday words={words} totals={mockTotals()} />);
    expect(document.querySelector("[data-totals]")!.textContent).toBe("7 positive·3 not interested·2 unclear");
  });
  it("says so when nothing has finished and 'Not available yet' when it cannot be read", () => {
    const { rerender } = render(<OutcomesToday words={words} totals={{ positive: 0, negative: 0, unclear: 0, notInterested: 0 }} />);
    expect(screen.getByText("No calls or follow-ups have finished yet today.")).toBeInTheDocument();
    rerender(<OutcomesToday words={words} totals={null} />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("every word exists in all four languages and holds no money or token", () => {
    for (const lang of ["en", "te", "hi", "kn"] as const) {
      const w = appDict(lang) as Record<string, string>;
      for (const k of Object.keys(w).filter((x) => x.startsWith("outcome."))) {
        expect(w[k], `${lang}:${k}`).toBeTruthy();
        expect(w[k], `${lang}:${k}`).not.toMatch(/₹|\btokens?\b/i);
      }
    }
  });
});
