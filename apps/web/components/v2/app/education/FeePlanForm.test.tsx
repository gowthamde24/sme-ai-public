import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseFeePlan, parseProgrammes } from "@/lib/api/education";
import { GROUP, PLAN, PLAN_DETAIL_JSON, PROGRAMME, PROGRAMMES_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { FeePlanForm, type FeePlanFormActions } from "./FeePlanForm";

function show(over: Partial<React.ComponentProps<typeof FeePlanForm>> = {}) {
  const go = vi.fn();
  const actions = { save: vi.fn(async (id: string, ...rest: unknown[]) => ({ ok: true as const, planId: id, rest })) } satisfies FeePlanFormActions;
  render(<FeePlanForm base={BASE} planId={PLAN} plan={null} copy={false} programmes={parseProgrammes(PROGRAMMES_JSON)} defaultYear="2026-27" words={WORDS} actions={actions} go={go} {...over} />);
  return { actions, go };
}
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: /Save the plan|Save the changes/ })));
const fillRow = (i: number, v: { no?: string; due: string; amount: string }) => {
  if (v.no !== undefined) fireEvent.change(document.getElementById(`fp-n${i}`)!, { target: { value: v.no } });
  fireEvent.change(document.getElementById(`fp-d${i}`)!, { target: { value: v.due } });
  fireEvent.change(document.getElementById(`fp-a${i}`)!, { target: { value: v.amount } });
};
beforeEach(() => vi.clearAllMocks());

describe("making a fee plan", () => {
  it("sends the instalments in paise under the page's id and opens the plan", async () => {
    const { actions, go } = show();
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: "Class 5 fees" } });
    fillRow(0, { due: "2026-06-15", amount: "25,000" });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fillRow(1, { no: "2", due: "2026-10-15", amount: "15000" });
    expect(screen.getByText(/Total: ₹40,000.00/)).toBeInTheDocument();
    await save();
    expect(actions.save).toHaveBeenCalledWith(PLAN, {
      name: "Class 5 fees", programmeId: PROGRAMME, groupId: "", academicYear: "2026-27", lateKind: "none", latePaise: null, lateGraceDays: 0, lateCapPaise: null, active: true,
      lines: [{ head: "tuition", instalment_no: 1, due_date: "2026-06-15", amount_paise: 2500000 }, { head: "tuition", instalment_no: 2, due_date: "2026-10-15", amount_paise: 1500000 }],
    });
    expect(go).toHaveBeenCalledWith(`${BASE}/fees/plans/${PLAN}?saved=1`);
  });
  it.each([
    ["no name", "", "2026-27", { due: "2026-06-15", amount: "100" }, "Give the plan a name"],
    ["a year that does not follow", "P", "2026-28", { due: "2026-06-15", amount: "100" }, "like 2026-27"],
    ["a row with no day", "P", "2026-27", { due: "", amount: "100" }, "Row 1: choose the day"],
    ["a row with no amount", "P", "2026-27", { due: "2026-06-15", amount: "" }, "Row 1: the amount"],
  ])("%s is refused before it is sent", async (_n, name, year, row, sentence) => {
    const { actions } = show();
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Academic year"), { target: { value: year } });
    fillRow(0, row);
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("the same head and number twice is named by row", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: "P" } });
    fillRow(0, { due: "2026-06-15", amount: "100" });
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fillRow(1, { no: "1", due: "2026-07-15", amount: "100" });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Row 2: this head and number are already in the plan");
  });
  it("a late-fee rule shows its boxes, a per-day rule a cap, and is checked", async () => {
    const { actions } = show();
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: "P" } });
    fillRow(0, { due: "2026-06-15", amount: "100" });
    expect(screen.queryByLabelText(/Late fee for each/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /An amount for each day late/ }));
    expect(screen.getByLabelText(/Most for one instalment/)).toBeInTheDocument();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("late fee as an amount");
    fireEvent.change(screen.getByLabelText("Late fee for each day (₹)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Grace days"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Most for one instalment/), { target: { value: "1000" } });
    await save();
    expect(actions.save.mock.calls[0][1]).toMatchObject({ lateKind: "per_day", latePaise: 5000, lateGraceDays: 3, lateCapPaise: 100000 });
  });
  it("lists the sections of the chosen programme", () => {
    show();
    expect(screen.getByRole("option", { name: "A" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Section (optional)"), { target: { value: GROUP } });
    expect((screen.getByLabelText("Section (optional)") as HTMLSelectElement).value).toBe(GROUP);
  });
});

describe("copying and changing", () => {
  it("a copy starts with the lines of the plan and says so; its program and year can change", () => {
    show({ plan: parseFeePlan(PLAN_DETAIL_JSON), copy: true });
    expect(screen.getByText(/This is a copy of another plan/)).toBeInTheDocument();
    expect(screen.getByLabelText("Academic year")).not.toBeDisabled();
    expect(screen.getByText(/Total: ₹62,000.00/)).toBeInTheDocument();
  });
  it("a plan nobody holds can be changed, but not its class or year", async () => {
    const { actions } = show({ plan: parseFeePlan({ ...PLAN_DETAIL_JSON, assigned: 0 }) });
    expect(screen.getByLabelText("Class or course")).toBeDisabled();
    expect(screen.getByLabelText("Academic year")).toBeDisabled();
    await save();
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.save.mock.calls[0][1]).toMatchObject({ lateKind: "fixed", latePaise: 20000, lateGraceDays: 5 });
  });
  it("a refusal because a student now holds the plan is shown", async () => {
    show({ actions: { save: async () => ({ ok: false, error: "A student already holds this plan, so it cannot change. Make a copy instead." }) } });
    fireEvent.change(screen.getByLabelText("Name of the plan"), { target: { value: "P" } });
    fillRow(0, { due: "2026-06-15", amount: "100" });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Make a copy");
  });
});
