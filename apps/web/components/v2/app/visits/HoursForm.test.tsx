import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/api/visits-fixtures";

import { HoursForm } from "./HoursForm";
import { WORDS, fakeVisitsActions } from "./visits-test-kit";

const show = async ({ canEdit = true, settings = SETTINGS, save = fakeVisitsActions().saveHours } = {}) => {
  await act(async () => void render(<HoursForm words={WORDS} lang="en" settings={settings} canEdit={canEdit} save={save as never} />));
  return save;
};
const click = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the store hours", () => {
  it("shows each weekday open or closed with its hours, the visit length, the visits at once and the closed dates", async () => {
    await show();
    expect(screen.getByLabelText("Monday: from")).toHaveValue("10:00");
    expect(screen.getByLabelText("Monday: to")).toHaveValue("20:30");
    expect(screen.getByRole("checkbox", { name: "Sunday" })).not.toBeChecked();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByLabelText("Length of one visit")).toHaveValue("30");
    expect(screen.getByLabelText("Visits at the same time")).toHaveValue(2);
    expect(screen.getByText(/20 Oct/)).toBeInTheDocument();
  });
  it("saves the whole week at once, as typed", async () => {
    const save = await show();
    fireEvent.click(screen.getByRole("checkbox", { name: "Monday" })); // closes Monday
    fireEvent.click(screen.getByRole("checkbox", { name: "Sunday" })); // opens Sunday with the standard hours
    fireEvent.change(screen.getByLabelText("Saturday: to"), { target: { value: "24:00" } });
    fireEvent.change(screen.getByLabelText("Length of one visit"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Visits at the same time"), { target: { value: "3" } });
    await click("Save the hours");
    expect(save).toHaveBeenCalledWith({
      weekly_hours: { ...SETTINGS.weekly_hours, mon: null, sun: { open: "10:00", close: "20:30" }, sat: { open: "10:00", close: "24:00" } },
      closed_dates: ["2026-10-20"],
      slot_minutes: 45,
      max_parallel: 3,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Hours saved. Visits already booked were not changed.");
  });
  it("adds and removes a closed date, kept in order and never twice", async () => {
    const save = await show();
    fireEvent.change(screen.getByLabelText("Add a closed day"), { target: { value: "2026-10-12" } });
    await click("Add");
    fireEvent.change(screen.getByLabelText("Add a closed day"), { target: { value: "2026-10-12" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled(); // already there
    await click("Remove 2026-10-20");
    await click("Save the hours");
    expect(save.mock.calls[0][0].closed_dates).toEqual(["2026-10-12"]);
  });
  it("will not save a closing time that is not after the opening time", async () => {
    await show();
    fireEvent.change(screen.getByLabelText("Monday: to"), { target: { value: "09:30" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The closing time must be after the opening time.");
    expect(screen.getByRole("button", { name: "Save the hours" })).toBeDisabled();
  });
  it("will not save a number of visits at once that is out of range", async () => {
    await show();
    for (const bad of ["0", "51", "2.5", ""]) {
      fireEvent.change(screen.getByLabelText("Visits at the same time"), { target: { value: bad } });
      expect(screen.getByRole("button", { name: "Save the hours" })).toBeDisabled();
    }
  });
  it("a refusal is shown in our words and keeps what was typed", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "Your role does not allow this. Nothing was changed." }));
    await show({ save: save as never });
    await click("Save the hours");
    expect(screen.getByRole("alert")).toHaveTextContent("Your role does not allow this. Nothing was changed.");
    expect(screen.getByLabelText("Monday: from")).toHaveValue("10:00");
  });
  it("'Undo my changes' puts the saved hours back", async () => {
    await show();
    fireEvent.click(screen.getByRole("checkbox", { name: "Monday" }));
    expect(screen.queryByLabelText("Monday: from")).toBeNull();
    await click("Undo my changes");
    expect(screen.getByLabelText("Monday: from")).toBeInTheDocument();
  });
  it("only the Owner and the Admin can change them: everyone else reads them, with no buttons and disabled fields", async () => {
    await show({ canEdit: false });
    expect(screen.getByText("Only the owner or an admin can change the hours.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Monday: from")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeDisabled();
  });
  it("says when these are the standard hours, until the business saves its own", async () => {
    await show({ settings: { ...SETTINGS, is_default: true } });
    expect(screen.getByText(/These are the standard hours/)).toBeInTheDocument();
    await click("Save the hours");
    expect(screen.queryByText(/These are the standard hours/)).toBeNull();
  });
  it("keeps an hour that is not on the half-hour list (a quarter hour saved earlier)", async () => {
    await show({ settings: { ...SETTINGS, weekly_hours: { ...SETTINGS.weekly_hours, mon: { open: "10:15", close: "20:30" } } } });
    expect(screen.getByLabelText("Monday: from")).toHaveValue("10:15");
    expect(within(screen.getByLabelText("Monday: from")).getAllByRole("option").length).toBeGreaterThan(40);
  });
  it("controls are at least 44 px", async () => {
    await show();
    expect(screen.getByLabelText("Monday: from").className).toContain("min-h-12");
    expect(screen.getByRole("button", { name: "Remove 2026-10-20" }).className).toContain("size-11");
  });
});
