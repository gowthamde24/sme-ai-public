import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import { AGENT_KEYS } from "@/lib/api/today";

import type { AgentRow } from "../today/types";
import { OfficeView } from "./OfficeView";

// a weak device: the List is the first view (the 3D view is tested in OfficeRoom.test.tsx)
vi.mock("./scene/capability", async (orig) => ({
  ...(await orig<typeof import("./scene/capability")>()),
  readClientEnv: () => ({ defaultView: "list", weak: true, webgl: false, reducedMotion: false, remembered: null, coarse: false, phone: false }),
}));

const en = appT("en");
const t = (k: string, v?: Record<string, string | number>) => en(k as "frame.notyet", v);
const NOW = Date.now();
const rows: AgentRow[] = AGENT_KEYS.map((agent) => ({ agent, state: "idle" as const, job: `Job of ${agent}.`, last_event: null }));
const set = (agent: AgentRow["agent"], patch: Partial<AgentRow>): AgentRow[] => rows.map((r) => (r.agent === agent ? { ...r, ...patch } : r));
const sample: AgentRow[] = set("quote_writer", { state: "working", job: "Prepares a quote from the prices you set.", last_event: { text: "Prepared quote 3", at: new Date(NOW - 3 * 3600_000).toISOString() } }).map((r) =>
  r.agent === "lead_finder" ? { ...r, state: "not_available" as const, job: "Finds new businesses that may want to buy. Not built yet." } : r.agent === "researcher" ? { ...r, state: "switched_off" as const, job: "Reads public pages about a lead." } : r,
);
const view = (agents: AgentRow[] | null, selected: string | null = null) => render(<OfficeView agents={agents} selected={selected} base="/app/tenants/T" t={t} />);
const cards = () => within(screen.getByRole("region", { name: "Agent office" })).getAllByRole("listitem");
afterEach(cleanup);

describe("OfficeView", () => {
  it("says 'Not available yet' and names no agent while the status cannot be read; there is no view switch to offer", () => {
    view(null);
    expect(screen.getAllByText("Not available yet")).toHaveLength(1);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "3D view" })).toBeNull();
    expect(screen.getByRole("link", { name: /Runs and cost/ })).toHaveAttribute("href", "/app/tenants/T/agents");
  });
  it("draws one card per agent, by name, with its state, what it does and its last event; each is a real link to its own detail", () => {
    view(sample);
    const items = cards();
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("Main agentIdleJob of main.");
    expect(items[4]).toHaveTextContent("Quote WriterWorkingPrepares a quote from the prices you set.Prepared quote 3 · 3h");
    expect(items[1]).toHaveTextContent("Lead FinderNot available yetFinds new businesses that may want to buy. Not built yet.");
    expect(within(items[4]).getByRole("link")).toHaveAttribute("href", "/app/tenants/T/office?agent=quote_writer");
  });
  it("a helper whose switch is off says 'Switched off', not 'Not available yet'", () => {
    view(sample);
    expect(cards()[2]).toHaveTextContent("ResearcherSwitched offReads public pages about a lead.");
    expect(within(cards()[2]).queryByText("Not available yet")).toBeNull();
  });
  it("the chosen agent's job and latest event are read beside the cards; with none chosen it says how to choose", () => {
    view(sample);
    expect(screen.getByText("Tap a teammate in the room, or choose one in the list, to read their latest events here.")).toBeInTheDocument();
    cleanup();
    view(sample, "quote_writer");
    expect(screen.getByRole("heading", { level: 2, name: "Quote Writer" })).toBeInTheDocument();
    expect(screen.getAllByText("Prepared quote 3 · 3h").length).toBe(2); // on the card and beside it
    expect(screen.getByText("3h · Quote Writer")).toBeInTheDocument(); // and the event feed, which keeps the time and the words on two lines
    expect(screen.getByRole("link", { name: /Quote Writer/ })).toHaveAttribute("aria-current", "true");
    cleanup();
    view(sample, "main");
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });
  it("an unknown ?agent= chooses nobody", () => {
    view(sample, "<script>");
    expect(screen.getByText(/Tap a teammate in the room/)).toBeInTheDocument();
  });
  it("cards are tall enough to touch (44px)", () => {
    view(sample);
    for (const a of within(screen.getByRole("region", { name: "Agent office" })).getAllByRole("link")) expect(a.className).toContain("min-h-24");
  });
});
