import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseRecipients } from "@/lib/api/campaigns";
import { RECIPIENTS_JSON } from "@/lib/api/campaigns-fixtures";
import { parseProgrammes } from "@/lib/api/education";
import { GROUP, PROGRAMME, PROGRAMMES_JSON } from "@/lib/api/education-fixtures";

import { WORDS } from "../materials/mat-test-kit";
import { AudiencePanel, type AudienceActions } from "./AudiencePanel";

const rows = parseRecipients(RECIPIENTS_JSON);
function show(over: Partial<React.ComponentProps<typeof AudiencePanel>> = {}, a: Partial<AudienceActions> = {}) {
  const actions = {
    fromLedger: vi.fn(async () => ({ ok: true as const, added: 5, skipped: [], recipients: 5 })),
    importList: vi.fn(async () => ({ ok: true as const, added: 1, skipped: [{ row: 2, reason: "contact_not_found" }, { row: 3, reason: "something_new" }], recipients: 1 })),
    clear: vi.fn(async () => ({ ok: true as const, removed: rows.length })),
    remove: vi.fn(async () => ({ ok: true as const })),
    ...a,
  };
  render(<AudiencePanel status="draft" money fromLedger recipients={rows} total={rows.length} words={WORDS} actions={actions} canEdit moreHref={null} {...over} />);
  return actions;
}
beforeEach(() => vi.clearAllMocks());

describe("who the campaign is for", () => {
  it("adds from the ledger for a checked range, with the party and the smallest amount", async () => {
    const a = show();
    fireEvent.change(screen.getByLabelText("Due from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Due until"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("Who owes"), { target: { value: "company" } });
    fireEvent.change(screen.getByLabelText("Smallest amount open (rupees)"), { target: { value: "500" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add from the ledger" })));
    expect(a.fromLedger).toHaveBeenCalledWith({ due_from: "2026-10-01", due_to: "2026-10-31", party: "company", min_open_paise: 50000 });
    expect(refresh).toHaveBeenCalled();
  });
  it("a range that runs backwards never reaches the server", async () => {
    const a = show();
    fireEvent.change(screen.getByLabelText("Due from"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Due until"), { target: { value: "2026-10-01" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add from the ledger" })));
    expect(screen.getByRole("alert")).toHaveTextContent("not after the end date");
    expect(a.fromLedger).not.toHaveBeenCalled();
  });
  it("a pasted list is read first: good lines are counted and bad lines are named by number, never guessed", () => {
    show();
    fireEvent.change(screen.getByLabelText("Or paste the list here"), { target: { value: "9000000001, 2026-10-20, 12500, INV-1\n9000000002, tomorrow, 100\nnobody, 2026-10-20, 5" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the list" }));
    expect(screen.getByText("1 lines can be added, 2 cannot be read.")).toBeInTheDocument();
    expect(screen.getByText("Line 2: the date cannot be read")).toBeInTheDocument();
    expect(screen.getByText("Line 3: the person is not a phone number or contact id")).toBeInTheDocument();
  });
  it("adds the good lines in paise and names what the server skipped, with 'could not be added' for a reason it has no words for", async () => {
    const a = show();
    fireEvent.change(screen.getByLabelText("Or paste the list here"), { target: { value: "9000000001, 2026-10-20, 125.50, INV-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the list" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add 1 people" })));
    expect(a.importList).toHaveBeenCalledWith([{ phone: "9000000001", due_date: "2026-10-20", amount_paise: 12550, reference: "INV-1" }]);
    expect(screen.getByText("Line 2: no contact with that number")).toBeInTheDocument();
    expect(screen.getByText("Line 3: could not be added")).toBeInTheDocument();
  });
  it("a reminder that is not about money refuses an amount column", () => {
    show({ money: false });
    fireEvent.change(screen.getByLabelText("Or paste the list here"), { target: { value: "9000000001, 2026-10-20, 500" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the list" }));
    expect(screen.getByText("Line 1: the amount is missing, wrong, or not needed for this kind")).toBeInTheDocument();
  });
  it("a business without a ledger has no ledger box", () => {
    show({ fromLedger: false });
    expect(screen.queryByRole("button", { name: "Add from the ledger" })).toBeNull();
  });
  it("a campaign that is running cannot be changed", () => {
    show({ status: "running", canEdit: false });
    expect(screen.queryByRole("button", { name: "Add from the ledger" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove everyone" })).toBeNull();
  });
  it("removing everyone asks first and says the people themselves are not deleted", async () => {
    const a = show();
    fireEvent.click(screen.getByRole("button", { name: "Remove everyone" }));
    expect(screen.getByText(/The people themselves are not deleted/)).toBeInTheDocument();
    expect(a.clear).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Remove everyone" })[1]));
    expect(a.clear).toHaveBeenCalledTimes(1);
  });
});

describe("a school's audiences", () => {
  it("a fee reminder is built from the ledger with the students' parents as the only party", async () => {
    const a = show({ studentParty: true });
    expect(screen.getByLabelText("Who owes")).toBeDisabled();
    expect(screen.getByRole("option", { name: /Students' parents/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Due from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Due until"), { target: { value: "2026-10-31" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add from the ledger" })));
    expect(a.fromLedger).toHaveBeenCalledWith({ due_from: "2026-10-01", due_to: "2026-10-31", party: "student" });
  });
  it("an announcement is built from the students: everyone, a class or a section, one message per parent", async () => {
    const announce = vi.fn(async () => ({ ok: true as const, added: 28, skipped: [{ row: 3, reason: "no_phone" }], recipients: 28 }));
    show({ money: false, fromLedger: false, programmes: parseProgrammes(PROGRAMMES_JSON) }, { announce });
    expect(screen.queryByLabelText("Or paste the list here")).toBeNull();
    fireEvent.change(screen.getByLabelText("The day to count the steps from"), { target: { value: "2026-10-20" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add the parents" })));
    expect(announce).toHaveBeenCalledWith({ scope: "all", programmeId: "", groupId: "", date: "2026-10-20" });
    expect(screen.getByRole("status")).toHaveTextContent("28 people added.");
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: "group" } });
    fireEvent.change(screen.getByLabelText("Class or course"), { target: { value: PROGRAMME } });
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: GROUP } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add the parents" })));
    expect(announce).toHaveBeenLastCalledWith({ scope: "group", programmeId: PROGRAMME, groupId: GROUP, date: "2026-10-20" });
  });
  it("an announcement needs a day, and a class or section when it is for one", async () => {
    const announce = vi.fn(async () => ({ ok: true as const, added: 0, skipped: [], recipients: 0 }));
    show({ money: false, fromLedger: false, programmes: parseProgrammes(PROGRAMMES_JSON) }, { announce });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add the parents" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the day");
    fireEvent.change(screen.getByLabelText("The day to count the steps from"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: "programme" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add the parents" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a class or course");
    expect(announce).not.toHaveBeenCalled();
  });
});
