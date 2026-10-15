import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseProgrammes, parseStudent } from "@/lib/api/education";
import { GROUP, GUARDIAN, PROGRAMME, PROGRAMMES_JSON, STUDENT, STUDENT_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { StudentForm, labelProblem, type StudentFormActions } from "./StudentForm";

const guardians = [{ id: GUARDIAN, name: "Ravi Kumar (synthetic)" }, { id: "22222222-2222-4222-8222-2222222222ab", name: "Lakshmi Devi (synthetic)" }];
function show(over: Partial<React.ComponentProps<typeof StudentForm>> = {}) {
  const go = vi.fn();
  const actions = { save: vi.fn<StudentFormActions["save"]>(async (id) => ({ ok: true as const, studentId: id })) };
  render(<StudentForm base={BASE} studentId={STUDENT} student={null} guardians={guardians} guardianFixed={null} programmes={parseProgrammes(PROGRAMMES_JSON)} words={WORDS} actions={actions} go={go} {...over} />);
  return { actions, go };
}
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add the student" })));
beforeEach(() => vi.clearAllMocks());

describe("the label rule", () => {
  it.each([["Asha", null], ["A.", null], ["రవి", null], ["", "empty"], ["  ", "empty"], ["Asha5", "chars"], ["a@b", "chars"], ["a".repeat(31), "long"], ["a".repeat(30), null]])("%j is %j", (text, want) => {
    expect(labelProblem(text)).toBe(want);
  });
});

describe("adding a student", () => {
  it("sends the minimum under the page's id and opens the student", async () => {
    const { actions, go } = show();
    fireEvent.change(screen.getByLabelText("Choose the parent or guardian"), { target: { value: GUARDIAN } });
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    fireEvent.change(screen.getByLabelText(/Admission number/), { target: { value: "A-1001" } });
    await save();
    expect(actions.save).toHaveBeenCalledWith(STUDENT, { contactId: GUARDIAN, isAdult: false, childLabel: "Asha", programmeId: PROGRAMME, groupId: GROUP, admissionNo: "A-1001", joinedOn: "" });
    expect(go).toHaveBeenCalledWith(`${BASE}/students/${STUDENT}?saved=1`);
  });
  it("there is no box for anything else about the child", () => {
    show();
    for (const word of [/birth/i, /address/i, /aadhaar/i, /photo/i, /note/i, /phone/i, /e-?mail/i]) expect(screen.queryByLabelText(word)).toBeNull();
  });
  it.each([["a digit", "Asha5", "no digits"], ["an e-mail", "a@b.c", "no digits"], ["nothing", "", "Give a first name"]])("a label with %s is refused before it is sent", async (_n, text, sentence) => {
    const { actions } = show();
    fireEvent.change(screen.getByLabelText("Choose the parent or guardian"), { target: { value: GUARDIAN } });
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: text } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("needs a guardian, and a section when the programme has sections", async () => {
    const { actions } = show();
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the parent or guardian first");
    fireEvent.change(screen.getByLabelText("Choose the parent or guardian"), { target: { value: GUARDIAN } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the Section");
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("finds a guardian by part of the name", () => {
    show();
    fireEvent.change(screen.getByPlaceholderText("Type part of the name to find them"), { target: { value: "laksh" } });
    expect(screen.getByRole("option", { name: "Lakshmi Devi (synthetic)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ravi Kumar (synthetic)" })).toBeNull();
  });
  it("an adult student has no label box", async () => {
    const { actions } = show({ guardians: [], guardianFixed: { id: GUARDIAN, name: "Ravi Kumar (synthetic)" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /adult student/i }));
    expect(screen.queryByLabelText("First name or initials")).toBeNull();
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    await save();
    expect(actions.save.mock.calls[0][1]).toMatchObject({ isAdult: true, childLabel: "" });
  });
  it("a refusal from the server is shown in our words", async () => {
    show({ guardians: [], guardianFixed: { id: GUARDIAN, name: "Ravi" }, actions: { save: async () => ({ ok: false, error: "That admission number belongs to another student." }) } });
    fireEvent.change(screen.getByLabelText("First name or initials"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("belongs to another student");
  });
});

describe("changing a student", () => {
  it("the guardian is fixed and shown by name; the form starts with what is kept", () => {
    show({ student: parseStudent(STUDENT_JSON), guardians: [] });
    expect(screen.getByText("Ravi Kumar (synthetic)")).toBeInTheDocument();
    expect(screen.getByLabelText("First name or initials")).toHaveValue("Asha (synthetic)");
    expect(screen.getByRole("button", { name: "Change the student" })).toBeInTheDocument();
  });
});
