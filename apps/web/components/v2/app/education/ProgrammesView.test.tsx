import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseProfile, parseProgrammes } from "@/lib/api/education";
import { PROFILE_JSON, PROFILE_NONE_JSON, PROGRAMMES_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { ProgrammesView, type ProgrammesActions } from "./ProgrammesView";

function show(role: "owner" | "admin" | "sales" = "owner", over: Partial<React.ComponentProps<typeof ProgrammesView>> = {}) {
  const actions = { saveProfile: vi.fn<ProgrammesActions["saveProfile"]>(async () => ({ ok: true as const })), saveProgramme: vi.fn<ProgrammesActions["saveProgramme"]>(async () => ({ ok: true as const })), saveGroup: vi.fn<ProgrammesActions["saveGroup"]>(async () => ({ ok: true as const })) };
  render(<ProgrammesView profile={parseProfile(PROFILE_JSON)} programmes={parseProgrammes(PROGRAMMES_JSON)} role={role} words={WORDS} actions={actions} base={BASE} {...over} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("the institution", () => {
  it("saves what the form shows", async () => {
    const a = show();
    fireEvent.change(screen.getByLabelText("Kind of institution"), { target: { value: "coaching" } });
    fireEvent.change(screen.getByLabelText("Academic year starts in"), { target: { value: "4" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the institution" })));
    expect(a.saveProfile).toHaveBeenCalledWith({ institutionType: "coaching", yearStartMonth: 4, terms: PROFILE_JSON.terms, parentLanguages: ["en", "te"], retentionMonths: null });
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
  it("only the Owner can change the retention months, and a bad number is refused before it is sent", async () => {
    const a = show("owner");
    fireEvent.change(screen.getByLabelText(/Erase a student's record/), { target: { value: "0" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the institution" })));
    expect(screen.getByRole("alert")).toHaveTextContent("whole number from 1 to 240");
    expect(a.saveProfile).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Erase a student's record/), { target: { value: "36" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the institution" })));
    expect(a.saveProfile.mock.calls[0][0].retentionMonths).toBe(36);
  });
  it("an Admin sees the months but cannot edit them; Sales read only", () => {
    show("admin");
    expect(screen.getByLabelText(/Erase a student's record/)).toBeDisabled();
    expect(screen.getByText(/Only the Owner can change this/)).toBeInTheDocument();
  });
  it("Sales cannot change anything", () => {
    show("sales");
    expect(screen.queryByRole("button", { name: "Save the institution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a class or course" })).toBeNull();
    expect(screen.getByLabelText("Kind of institution")).toBeDisabled();
  });
  it("at least one language and a name for every term", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("checkbox", { name: "English" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Telugu" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the institution" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one language");
    expect(a.saveProfile).not.toHaveBeenCalled();
  });
  it("a school that is not set up yet says so", () => {
    show("owner", { profile: parseProfile(PROFILE_NONE_JSON), programmes: [] });
    expect(screen.getByText(/Not set up yet/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });
});

describe("classes, courses and sections", () => {
  it("adds a programme under a new id and never twice", async () => {
    const a = show();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a class or course" })[0]);
    fireEvent.change(screen.getByLabelText(/Name \(for example Class 5/), { target: { value: "Class 6" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(a.saveProgramme).toHaveBeenCalledTimes(1);
    expect(a.saveProgramme.mock.calls[0][1]).toEqual({ name: "Class 6", kind: "class", groupKind: "section", active: true });
    expect(a.saveProgramme.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(refresh).toHaveBeenCalled();
  });
  it("a programme needs a name", async () => {
    const a = show();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a class or course" })[0]);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the class or course a name");
    expect(a.saveProgramme).not.toHaveBeenCalled();
  });
  it("adds a section to a programme that has sections, and a programme with none has no add button", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a section" }));
    fireEvent.change(screen.getByLabelText(/Name \(for example A, Year 2/), { target: { value: "C" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(a.saveGroup).toHaveBeenCalledWith(PROGRAMMES_JSON.items[0].id, expect.any(String), { label: "C", timing: null, active: true });
    expect(screen.getAllByRole("button", { name: /Add a (section|year|semester|batch)/ })).toHaveLength(2);
  });
  it("shows how many students are in each section", () => {
    show();
    expect(screen.getByRole("button", { name: "Change A" })).toHaveTextContent("16");
  });
});
