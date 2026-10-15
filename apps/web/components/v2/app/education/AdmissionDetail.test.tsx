import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { parseAdmissionDetail, parseFeePlanList, parseProgrammes } from "@/lib/api/education";
import { ADMISSION, ADMISSION_DETAIL_JSON, GROUP, PLAN, PLAN_LIST_JSON, PROGRAMME, PROGRAMMES_JSON, STUDENT } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { AdmissionDetail, type AdmissionActions } from "./AdmissionDetail";

const at = (stage: string, over: object = {}) => parseAdmissionDetail({ ...ADMISSION_DETAIL_JSON, stage, ...over });
function show(admission = at("campus_visit"), role: "owner" | "admin" | "sales" = "owner", a: Partial<AdmissionActions> = {}) {
  const actions = { stage: vi.fn(async () => ({ ok: true as const })), admit: vi.fn(async () => ({ ok: true as const, studentId: STUDENT })), ...a };
  render(<AdmissionDetail admission={admission} base={BASE} role={role} words={WORDS} programmes={parseProgrammes(PROGRAMMES_JSON)} plans={parseFeePlanList(PLAN_LIST_JSON)} saved={false} today="2026-10-14" actions={actions} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("moving an enquiry forward", () => {
  it("an enquiry can go to a campus visit or an application, never backwards", async () => {
    const a = show(at("enquiry"));
    expect(screen.getByRole("button", { name: "Visited the campus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Application received" })).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Application received" })));
    expect(a.stage).toHaveBeenCalledWith("application", null);
    expect(refresh).toHaveBeenCalled();
  });
  it("a campus visit can only go to an application; a visit is booked on the visits page for this lead", () => {
    show(at("campus_visit"));
    expect(screen.queryByRole("button", { name: "Visited the campus" })).toBeNull();
    expect(screen.getByRole("link", { name: "Book a campus visit" })).toHaveAttribute("href", `${BASE}/visits?lead=${ADMISSION_DETAIL_JSON.lead_id}`);
  });
  it("shows every stage reached with its day", () => {
    show();
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("2026-10-08"), expect.stringContaining("2026-10-10")]));
  });
});

describe("losing and re-opening", () => {
  it("lost asks for a reason and sends it", async () => {
    const a = show(at("application"));
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "distance" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Mark as lost" })));
    expect(a.stage).toHaveBeenCalledWith("lost", "distance");
  });
  it("an Owner or Admin can re-open a lost enquiry; Sales cannot", async () => {
    const a = show(at("lost", { lost_reason: "fees" }), "admin");
    fireEvent.click(screen.getByRole("button", { name: "Re-open" }));
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Re-open" })[1]));
    expect(a.stage).toHaveBeenCalledWith("enquiry", null);
  });
  it("Sales cannot re-open", () => {
    show(at("lost", { lost_reason: "fees" }), "sales");
    expect(screen.queryByRole("button", { name: "Re-open" })).toBeNull();
  });
});

describe("admitting", () => {
  it("makes the student with a label, a placement and a plan, under two ids made when the sheet opens", async () => {
    const a = show(at("application"));
    fireEvent.click(screen.getByRole("button", { name: "Admit" }));
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    fireEvent.change(screen.getByLabelText("Fee plan (optional)"), { target: { value: PLAN } });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Admit" })[1]));
    expect(a.admit).toHaveBeenCalledTimes(1);
    const sent = (a.admit as unknown as { mock: { calls: [{ studentId: string; assignmentId: string }][] } }).mock.calls[0][0];
    expect(sent).toMatchObject({ isAdult: false, childLabel: "Asha", programmeId: PROGRAMME, groupId: GROUP, planId: PLAN, joinedOn: "2026-10-14" });
    expect(sent.studentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.assignmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(push).toHaveBeenCalledWith(`${BASE}/students/${STUDENT}?saved=1`);
  });
  it("a label with a digit is refused before the request", async () => {
    const a = show(at("application"));
    fireEvent.click(screen.getByRole("button", { name: "Admit" }));
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha5" } });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Admit" })[1]));
    expect(screen.getByRole("alert")).toHaveTextContent("no digits");
    expect(a.admit).not.toHaveBeenCalled();
  });
  it("only the Owner and Admins admit", () => {
    show(at("application"), "sales");
    expect(screen.queryByRole("button", { name: "Admit" })).toBeNull();
    expect(screen.getByText(/Only the Owner and Admins can admit/)).toBeInTheDocument();
  });
  it("an admitted enquiry opens its student and has nothing to move", () => {
    show(at("admitted", { student_id: STUDENT }), "owner");
    expect(screen.getByRole("link", { name: "Open the student" })).toHaveAttribute("href", `${BASE}/students/${STUDENT}`);
    expect(screen.queryByRole("button", { name: "Lost" })).toBeNull();
  });
  it("a refusal in the admit sheet stays there in our words", async () => {
    show(at("application"), "owner", { admit: async () => ({ ok: false, error: "That admission number belongs to another student." }) });
    fireEvent.click(screen.getByRole("button", { name: "Admit" }));
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha" } });
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Admit" })[1]));
    expect(screen.getByRole("alert")).toHaveTextContent("belongs to another student");
    expect(push).not.toHaveBeenCalled();
    expect(ADMISSION).toBeTruthy();
  });
});
