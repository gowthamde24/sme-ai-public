import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentCostOut } from "@/lib/api/agents";

import { CostPanel, money } from "./cost-panel";

const cost = (over: Partial<AgentCostOut> = {}): AgentCostOut => ({
  day: "2026-10-04",
  cap_micros: 2_000_000,
  settled_micros: 400,
  open_micros: 900,
  open: [
    { run_id: "11111111-1111-4111-8111-111111111111", step_key: "usage-2", reserved_micros: 700, run_status: "cancelled", created_at: "2026-10-04T12:00:00+00:00" },
    { run_id: "22222222-2222-4222-8222-222222222222", step_key: "usage-1", reserved_micros: 200, run_status: "running", created_at: "2026-10-04T12:05:00+00:00" },
  ],
  ...over,
});

describe("money", () => {
  it("shows millionths as a plain number", () => {
    expect([0, 400, 1_500_000, 2_000_000, 123].map(money)).toEqual(["0", "0.0004", "1.5", "2", "0.0001"]);
  });
});

describe("CostPanel", () => {
  it("shows settled and open next to the cap, and each open reservation with its run's status", () => {
    render(<CostPanel cost={cost()} />);
    expect(screen.getByRole("heading", { name: /Today's agent spending/ })).toBeInTheDocument();
    expect(screen.getByText("0.0004")).toBeInTheDocument();
    expect(screen.getByText("0.0009")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/run cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/run running/)).toBeInTheDocument();
    expect(screen.getByText(/counted at its worst case until midnight India time/)).toBeInTheDocument();
  });

  it("says when nothing is open, and when the API could not be reached", () => {
    const { unmount } = render(<CostPanel cost={cost({ open: [], open_micros: 0 })} />);
    expect(screen.getByText("Nothing is open.")).toBeInTheDocument();
    unmount();
    render(<CostPanel cost={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load the spending/);
  });
});
