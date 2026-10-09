import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appT } from "@/i18n/app";

import type { AgentRow } from "../today/types";
import { OfficeView } from "./OfficeView";

const en = appT("en");
const t = (k: string, v?: Record<string, string | number>) => en(k as "frame.notyet", v);
const rows: AgentRow[] = [
  { agent: "Main agent", state: "idle", job: null, last_event: null },
  { agent: "Lead Finder", state: "working", job: "Reading a directory", last_event: "Passed a lead to the Researcher." },
  { agent: "Order Desk", state: "not_available", job: null, last_event: null },
];
const view = (agents: AgentRow[] | null, selected: string | null = null) => render(<OfficeView agents={agents} selected={selected} base="/app/tenants/T" t={t} />);
afterEach(cleanup);

describe("OfficeView", () => {
  it("says 'Not available yet' and names no agent while the status cannot be read", () => {
    view(null);
    expect(screen.getAllByText("Not available yet")).toHaveLength(1);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("link", { name: /Runs and cost/ })).toHaveAttribute("href", "/app/tenants/T/agents");
  });
  it("draws one card per agent with its state, what it is doing and its last event; each is a real link to its own detail", () => {
    view(rows);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Main agentIdle");
    expect(items[1]).toHaveTextContent("Lead FinderWorkingReading a directoryPassed a lead to the Researcher.");
    expect(items[2]).toHaveTextContent("Order DeskNot available yet");
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/app/tenants/T/office?agent=Lead%20Finder");
  });
  it("the chosen agent's latest event is read beside the cards; with none chosen it says how to choose", () => {
    view(rows);
    expect(screen.getByText("Choose a teammate to read their latest events.")).toBeInTheDocument();
    cleanup();
    view(rows, "Lead Finder");
    expect(screen.getByRole("heading", { level: 2, name: "Lead Finder" })).toBeInTheDocument();
    expect(screen.getAllByText("Passed a lead to the Researcher.").length).toBe(2); // on the card and beside it
    expect(screen.getByRole("link", { name: /Lead Finder/ })).toHaveAttribute("aria-current", "true");
    cleanup();
    view(rows, "Main agent");
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });
  it("cards are tall enough to touch (44px)", () => {
    view(rows);
    for (const a of screen.getAllByRole("link", { name: /Main agent|Lead Finder|Order Desk/ })) expect(a.className).toContain("min-h-24");
  });
});
