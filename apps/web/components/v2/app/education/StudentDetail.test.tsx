import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseGuardianFees, parseStudent } from "@/lib/api/education";
import { GUARDIAN, GUARDIAN_FEES_JSON, STUDENT, STUDENT_ERASED_JSON, STUDENT_JSON, STUDENT_LEFT_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { StudentDetail, type StudentDetailActions } from "./StudentDetail";

function show(over: Partial<React.ComponentProps<typeof StudentDetail>> = {}, a: Partial<StudentDetailActions> = {}) {
  const actions = { setStatus: vi.fn(async () => ({ ok: true as const })), erase: vi.fn(async () => ({ ok: true as const })), ...a };
  render(<StudentDetail student={parseStudent(STUDENT_JSON)} base={BASE} role="owner" words={WORDS} guardianFees={parseGuardianFees(GUARDIAN_FEES_JSON)} today="2026-10-14" saved={false} actions={actions} {...over} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("one student", () => {
  it("shows the record and what the whole family owes, with one total", () => {
    show();
    expect(screen.getByRole("heading", { name: "Asha (synthetic)" })).toBeInTheDocument();
    expect(screen.getByText("A-1001")).toBeInTheDocument();
    expect(screen.getByText("Pending in all").closest("p")).toHaveTextContent("₹37,000.00");
    expect(screen.getByRole("link", { name: "Add another child of this parent" })).toHaveAttribute("href", `${BASE}/students/new?contact=${GUARDIAN}`);
  });
  it("marks a student as left on a day, with a question first", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("button", { name: "Mark as left" }));
    expect(a.setStatus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Left on"), { target: { value: "2026-09-30" } });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Mark as left" })[1]));
    expect(a.setStatus).toHaveBeenCalledWith("left", "2026-09-30");
    expect(refresh).toHaveBeenCalled();
  });
  it("a student who left can be marked as here again", async () => {
    const a = show({ student: parseStudent(STUDENT_LEFT_JSON) });
    fireEvent.click(screen.getByRole("button", { name: "Mark as here again" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Mark as here" })));
    expect(a.setStatus).toHaveBeenCalledWith("active", null);
  });
  it("only the Owner can erase, and the sheet says it cannot be undone", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("button", { name: "Erase this child" }));
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Erase for good" })));
    expect(a.erase).toHaveBeenCalledTimes(1);
  });
  it("an Admin has no erase button; Sales have no buttons that change anything", () => {
    show({ role: "admin" });
    expect(screen.queryByRole("button", { name: "Erase this child" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as left" })).toBeInTheDocument();
  });
  it("Sales only read", () => {
    show({ role: "sales" });
    expect(screen.queryByRole("button", { name: "Mark as left" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
  });
  it("a missing second factor points at the Security page and keeps the sheet", async () => {
    show({}, { erase: async () => ({ ok: false, error: "This needs your authenticator app.", mfa: true }) });
    fireEvent.click(screen.getByRole("button", { name: "Erase this child" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Erase for good" })));
    expect(screen.getByRole("alert")).toHaveTextContent("authenticator");
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
  it("an erased student is shown as erased, with no name and nothing to change", () => {
    show({ student: parseStudent(STUDENT_ERASED_JSON), guardianFees: null });
    expect(screen.getAllByText("Erased").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Erase this child" })).toBeNull();
    expect(document.body.textContent).not.toContain("Kiran");
  });
  it("does not exist for a student id of its own page (a link back to the list)", () => {
    show();
    expect(screen.getByRole("link", { name: "All students" })).toHaveAttribute("href", `${BASE}/students`);
    expect(STUDENT).toBeTruthy();
  });
});
