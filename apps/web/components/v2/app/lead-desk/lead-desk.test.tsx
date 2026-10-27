import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { appDict } from "@/i18n/app";

import { AssignSelect } from "./AssignSelect";
import { LeadTimeline } from "./LeadTimeline";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^ld\./.test(k)));
const members = [{ id: "u1", name: "Asha" }, { id: "u2", name: "Ravi" }];
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("handing a lead to someone", () => {
  it("the Owner and Admin choose a person or nobody, and the list is refreshed", async () => {
    const assign = vi.fn(async () => ({ ok: true as const }));
    render(<AssignSelect words={words} leadId="l1" current={null} members={members} canEdit assign={assign} />);
    const select = screen.getByLabelText("Handed to");
    expect(select).toHaveValue("");
    await act(async () => void fireEvent.change(select, { target: { value: "u2" } }));
    expect(assign).toHaveBeenCalledWith("l1", "u2");
    expect(refresh).toHaveBeenCalled();
    await act(async () => void fireEvent.change(select, { target: { value: "" } }));
    expect(assign).toHaveBeenLastCalledWith("l1", null);
  });
  it("a failure puts the old person back and says so", async () => {
    const assign = vi.fn(async () => ({ ok: false as const, error: "down" as const }));
    render(<AssignSelect words={words} leadId="l1" current="u1" members={members} canEdit assign={assign} />);
    await act(async () => void fireEvent.change(screen.getByLabelText("Handed to"), { target: { value: "u2" } }));
    expect(screen.getByLabelText("Handed to")).toHaveValue("u1");
    expect(screen.getByRole("alert")).toHaveTextContent("still with the same person");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("others only read the name", () => {
    render(<AssignSelect words={words} leadId="l1" current="u1" members={members} canEdit={false} assign={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    cleanup();
    render(<AssignSelect words={words} leadId="l1" current={null} members={members} canEdit={false} assign={vi.fn()} />);
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
  });
});

describe("how a lead arrived", () => {
  const sourceNames = { indiamart: "IndiaMART", meta_lead_ads: "Meta lead ads" };
  it("lists the first arrival and each time they came again, with the source and the words, as plain text", () => {
    render(<LeadTimeline words={words} lang="en" sourceNames={sourceNames} flags={[]} touches={[{ at: "2026-10-27T05:00:00Z", kind: "first", source: "meta_lead_ads", message: "Please call <b>me</b>" }, { at: "2026-10-28T05:00:00Z", kind: "repeat", source: "indiamart", message: null }]} />);
    expect(screen.getByText("First arrived")).toBeInTheDocument();
    expect(screen.getByText("Came again")).toBeInTheDocument();
    expect(screen.getByText("Meta lead ads")).toBeInTheDocument();
    expect(screen.getByText("IndiaMART")).toBeInTheDocument();
    expect(document.querySelector("[data-part=lead-timeline]")?.textContent).toContain("Please call <b>me</b>");
    expect(document.querySelector("[data-part=lead-timeline] b")).toBeNull();
  });
  it("says the number is on the do-not-disturb list (WhatsApp only), and when nothing is recorded", () => {
    render(<LeadTimeline words={words} lang="en" sourceNames={sourceNames} flags={["dnd", "invalid_number"]} touches={[]} />);
    expect(screen.getByText(/do-not-disturb list: WhatsApp only/)).toBeInTheDocument();
    expect(screen.getByText("The number does not look right")).toBeInTheDocument();
    expect(screen.getByText("No arrivals are recorded for this lead yet.")).toBeInTheDocument();
  });
});
