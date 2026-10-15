import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseFeePlanList } from "@/lib/api/education";
import { ASSIGNMENT, FEE_STATEMENT_JSON, PLAN, PLAN_LIST_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { FeeAssignment, type FeeAssignmentActions } from "./FeeAssignment";

const plans = parseFeePlanList(PLAN_LIST_JSON);
function show(over: Partial<React.ComponentProps<typeof FeeAssignment>> = {}, a: Partial<FeeAssignmentActions> = {}) {
  const actions = { assign: vi.fn(async () => ({ ok: true as const })), void: vi.fn(async () => ({ ok: true as const })), ...a };
  render(<FeeAssignment assignment={null} plans={plans} canEdit assignmentId={ASSIGNMENT} words={WORDS} actions={actions} base={BASE} {...over} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("a student's fee plan", () => {
  it("giving a plan asks first, shows the total, and uses the page's assignment id", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("button", { name: "Give this plan" }));
    expect(a.assign).not.toHaveBeenCalled();
    expect(screen.getByText("₹62,000.00")).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Give the plan" })));
    expect(a.assign).toHaveBeenCalledWith(ASSIGNMENT, PLAN);
    expect(refresh).toHaveBeenCalled();
  });
  it("a student with a plan shows it and offers to take it off, after a question", async () => {
    const a = show({ assignment: { ...FEE_STATEMENT_JSON.assignment } });
    expect(screen.getByRole("link", { name: "Class 5 fees 2026-27 (synthetic)" })).toHaveAttribute("href", `${BASE}/fees/plans/${PLAN}`);
    fireEvent.click(screen.getByRole("button", { name: "Take the plan off" }));
    expect(screen.getByText(/voided, not deleted/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Take it off" })));
    expect(a.void).toHaveBeenCalledWith(ASSIGNMENT);
  });
  it("Sales cannot give or take off", () => {
    show({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Give this plan" })).toBeNull();
    show({ canEdit: false, assignment: { ...FEE_STATEMENT_JSON.assignment } });
    expect(screen.queryByRole("button", { name: "Take the plan off" })).toBeNull();
  });
  it("with no plan for the class, points at making one", () => {
    show({ plans: [] });
    expect(screen.getByText(/no active plan for this class/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a fee plan" })).toBeInTheDocument();
  });
  it("a refusal stays in the sheet in our words", async () => {
    show({}, { assign: async () => ({ ok: false, error: "This student already has a fee plan for that year." }) });
    fireEvent.click(screen.getByRole("button", { name: "Give this plan" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Give the plan" })));
    expect(screen.getByRole("alert")).toHaveTextContent("already has a fee plan");
  });
});
