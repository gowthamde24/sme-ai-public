import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityCall } from "@/lib/employees/types";

import { acts, defaultEmployee, employee, ok, show } from "./fixtures";

vi.mock("next/link", () => import("./link-mock"));

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;
const call = (n: number, over: Partial<ActivityCall> = {}): ActivityCall => ({ id: `c${n}`, direction: "inbound", state: "completed", purpose: null, language: "te", outcome: "interested", durationS: 75, createdAt: `2026-11-${String(30 - n).padStart(2, "0")}T10:00:00Z`, ...over });

describe("Responsibilities", () => {
  it("shows the nine jobs with the ticked ones and saves exactly the list, keeping an id it does not know", async () => {
    const { a } = show({ initialTab: "responsibilities", employee: employee({ responsibilities: ["faq_answers", "newer_job"] }) });
    const c = await card("What it takes care of");
    expect(within(c).getAllByRole("checkbox")).toHaveLength(9);
    expect(within(c).getByRole("checkbox", { name: "Answer common questions" })).toBeChecked();
    expect(within(c).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(c).getByRole("checkbox", { name: "Book store visits" }));
    fireEvent.click(within(c).getByRole("checkbox", { name: "Answer common questions" }));
    fireEvent.click(within(c).getByRole("checkbox", { name: "Reply to new enquiries" }));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ responsibilities: ["enquiry_reply", "visit_booking", "newer_job"] }));
    expect(await within(c).findByText("Saved")).toBeInTheDocument();
  });

  it("is editable for the main assistant too, and read-only for a reader", async () => {
    const { a } = show({ initialTab: "responsibilities", employee: defaultEmployee({ responsibilities: [] }) });
    const c = await card("What it takes care of");
    fireEvent.click(within(c).getByRole("checkbox", { name: "Book store visits" }));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ responsibilities: ["visit_booking"] }));
  });

  it("a reader has no Save", async () => {
    show({ initialTab: "responsibilities", canEdit: false });
    const c = await card("What it takes care of");
    expect(within(c).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(c).getByRole("checkbox", { name: "Answer common questions" })).toBeDisabled();
  });
});

describe("Activity", () => {
  it("says plainly when there are no calls", async () => {
    show({ initialTab: "activity" });
    expect(await screen.findByText("No calls yet. The calls it takes will show here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("pages by the date of the last call and hides Show more on a short page", async () => {
    const first = Array.from({ length: 30 }, (_, i) => call(i + 1));
    const second = [call(31, { direction: "outbound", outcome: null, durationS: 20, language: "en" })];
    const a = acts();
    a.activity.mockResolvedValueOnce(ok(first)).mockResolvedValueOnce(ok(second));
    show({ initialTab: "activity" }, a);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(30));
    expect(a.activity).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-call", "c1");
    expect(within(screen.getAllByRole("listitem")[0]).getByText(/Interested/)).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[0]).getByText(/1 min 15 sec/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(31));
    expect(a.activity).toHaveBeenLastCalledWith(first[29].createdAt);
    const last = screen.getAllByRole("listitem")[30];
    expect(within(last).getByText("Outgoing")).toBeInTheDocument();
    expect(within(last).getByText(/No result written down/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says the closed sentence when the calls cannot be read", async () => {
    const a = acts();
    a.activity.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    show({ initialTab: "activity" }, a);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not do that now. Nothing was changed. Please try again.");
  });
});

describe("Phone", () => {
  it("lists the lines, None, and the one taken by another employee as not pickable", async () => {
    show({ initialTab: "phone" });
    const c = await card("Phone line");
    expect(within(c).getByText(/A line with none goes to the main assistant\./)).toBeInTheDocument();
    expect(within(c).getByRole("radio", { name: /None/ })).toBeChecked();
    expect(within(c).getByRole("radio", { name: /98765 43210/ })).toBeEnabled();
    expect(within(c).getByRole("radio", { name: /98765 00000/ })).toBeDisabled();
    expect(within(c).getByText("Already with Ravi")).toBeInTheDocument();
  });

  it("saves the picked line, then None", async () => {
    const { a } = show({ initialTab: "phone" });
    a.setPhone.mockResolvedValueOnce(ok(employee({ phoneNumberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })));
    const c = await card("Phone line");
    expect(within(c).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(within(c).getByRole("radio", { name: /98765 43210/ }));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.setPhone).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    a.setPhone.mockResolvedValueOnce(ok(employee({ phoneNumberId: null })));
    fireEvent.click(within(c).getByRole("radio", { name: /None/ }));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.setPhone).toHaveBeenLastCalledWith(null));
  });

  it("says plainly when no line can be picked", async () => {
    show({ initialTab: "phone", lines: [] });
    expect(await screen.findByText(/No phone line can be picked yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("the main assistant has nothing to pick: it answers every line with no employee", async () => {
    show({ initialTab: "phone", employee: defaultEmployee() });
    expect(await screen.findByText("The main assistant answers every phone line that has no other AI employee.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
