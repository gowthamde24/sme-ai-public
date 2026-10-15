import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseProgrammes } from "@/lib/api/education";
import { ADMISSION, GUARDIAN, PROGRAMME, PROGRAMMES_JSON } from "@/lib/api/education-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { AdmissionForm, type AdmissionFormActions } from "./AdmissionForm";

function show(guardians = [{ id: GUARDIAN, name: "Ravi Kumar (synthetic)" }]) {
  const go = vi.fn();
  const actions = { save: vi.fn(async (id: string, ...rest: unknown[]) => ({ ok: true as const, admissionId: id, rest })) } satisfies AdmissionFormActions;
  render(<AdmissionForm base={BASE} admissionId={ADMISSION} programmes={parseProgrammes(PROGRAMMES_JSON)} guardians={guardians} words={WORDS} actions={actions} go={go} />);
  return { actions, go };
}
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the enquiry" })));
beforeEach(() => vi.clearAllMocks());

describe("a new enquiry", () => {
  it("a new parent: a name and a number, and no child anywhere", async () => {
    const { actions, go } = show();
    expect(screen.getByText("No child is stored until the enquiry is admitted.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Where it came from"), { target: { value: "referral" } });
    fireEvent.change(screen.getByLabelText("Class or course asked about"), { target: { value: PROGRAMME } });
    fireEvent.change(screen.getByLabelText("Parent or guardian's name"), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText("Their WhatsApp number"), { target: { value: "+00 11111 11111" } });
    await save();
    expect(actions.save).toHaveBeenCalledWith(ADMISSION, { source: "referral", programmeId: PROGRAMME, contactId: "", guardianName: "Ravi Kumar", guardianPhone: "+00 11111 11111" });
    expect(go).toHaveBeenCalledWith(`${BASE}/admissions/${ADMISSION}?saved=1`);
  });
  it("a number with letters is refused before it is sent", async () => {
    const { actions } = show();
    fireEvent.change(screen.getByLabelText("Parent or guardian's name"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Their WhatsApp number"), { target: { value: "call me" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("digits, spaces, plus");
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("an existing parent is chosen from the list and no name or number goes with it", async () => {
    const { actions } = show();
    fireEvent.click(screen.getByRole("radio", { name: "Someone already in my list" }));
    fireEvent.change(screen.getByLabelText("Choose the parent or guardian"), { target: { value: GUARDIAN } });
    await save();
    expect(actions.save.mock.calls[0][1]).toMatchObject({ contactId: GUARDIAN, guardianName: "", guardianPhone: "" });
  });
  it("with nobody in the list there is no choice to make", () => {
    show([]);
    expect(screen.queryByRole("radio", { name: "Someone already in my list" })).toBeNull();
  });
  it("needs a name", async () => {
    const { actions } = show();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("parent or guardian's name");
    expect(actions.save).not.toHaveBeenCalled();
  });
});
