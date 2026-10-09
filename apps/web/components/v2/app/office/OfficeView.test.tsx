import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appT } from "@/i18n/app";

import type { AgentRow } from "../today/types";
import { OfficeView } from "./OfficeView";

const en = appT("en");
const t = (k: string, v?: Record<string, string | number>) => en(k as "frame.notyet", v);
const NOW = Date.now();
const rows: AgentRow[] = [
  { agent: "researcher", state: "idle", job: "Reads public pages about a lead.", last_event: null },
  { agent: "quote_writer", state: "working", job: "Prepares a quote from the prices you set.", last_event: { text: "Prepared quote 3", at: new Date(NOW - 3 * 3600_000).toISOString() } },
  { agent: "lead_finder", state: "not_available", job: "Finds new businesses that may want to buy. Not built yet.", last_event: null },
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
  it("draws one card per agent, by name, with its state, what it does and its last event; each is a real link to its own detail", () => {
    view(rows);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("ResearcherIdleReads public pages about a lead.");
    expect(items[1]).toHaveTextContent("Quote WriterWorkingPrepares a quote from the prices you set.Prepared quote 3 · 3h");
    expect(items[2]).toHaveTextContent("Lead FinderNot available yetFinds new businesses that may want to buy. Not built yet.");
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/app/tenants/T/office?agent=quote_writer");
  });
  it("the chosen agent's job and latest event are read beside the cards; with none chosen it says how to choose", () => {
    view(rows);
    expect(screen.getByText("Choose a teammate to read their latest events.")).toBeInTheDocument();
    cleanup();
    view(rows, "quote_writer");
    expect(screen.getByRole("heading", { level: 2, name: "Quote Writer" })).toBeInTheDocument();
    expect(screen.getAllByText("Prepared quote 3 · 3h").length).toBe(2); // on the card and beside it
    expect(screen.getByRole("link", { name: /Quote Writer/ })).toHaveAttribute("aria-current", "true");
    cleanup();
    view(rows, "researcher");
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });
  it("cards are tall enough to touch (44px)", () => {
    view(rows);
    for (const a of screen.getAllByRole("link", { name: /Researcher|Quote Writer|Lead Finder/ })) expect(a.className).toContain("min-h-24");
  });
});
