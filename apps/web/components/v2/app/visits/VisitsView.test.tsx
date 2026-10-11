import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEAD_A, SETTINGS, VISIT_1, VISIT_2, VISIT_3, slotsJson, visit } from "@/lib/api/visits-fixtures";

import type { Role } from "../today/types";
import { VisitsView, type VisitsViewProps } from "./VisitsView";
import { BASE, NOW, TODAY, WORDS, fakeVisitsActions } from "./visits-test-kit";

const VISITS = [
  visit({ id: VISIT_3, who: "Anita R.", party_size: 1, purpose: null, status: "booked", starts_at: "2026-10-14T05:00:00Z", ends_at: "2026-10-14T05:30:00Z" }),
  visit({ id: VISIT_1, who: "Priya S.", status: "confirmed", starts_at: "2026-10-14T06:30:00Z", ends_at: "2026-10-14T07:00:00Z" }),
  visit({ id: VISIT_2, who: "Lakshmi Textiles", status: "completed", outcome: "will_return", starts_at: "2026-10-14T04:30:00Z", ends_at: "2026-10-14T05:00:00Z" }),
];
const props = (over: Partial<VisitsViewProps> = {}): VisitsViewProps => ({
  view: "day", day: TODAY, today: TODAY, now: NOW, lang: "en", role: "owner" as Role, base: BASE, words: WORDS, visits: VISITS, slots: slotsJson(TODAY), hours: SETTINGS,
  actions: fakeVisitsActions(), lead: null, time: null, focus: null, ...over,
});
const show = async (over: Partial<VisitsViewProps> = {}) => {
  await act(async () => void render(<VisitsView {...props(over)} />));
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the Visits page: a day", () => {
  it("has the title, the two tabs, and the day with its weekday and date", async () => {
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Store visits");
    expect(screen.getByRole("link", { name: "Day" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Store hours" })).toHaveAttribute("href", `${BASE}/visits?view=hours`);
    expect(screen.getByRole("heading", { name: "Wednesday, 14 October 2026" })).toBeInTheDocument();
  });
  it("moves to the previous and the next day, and back to today", async () => {
    await show({ day: "2026-10-15" });
    expect(screen.getByRole("link", { name: "Previous day" })).toHaveAttribute("href", `${BASE}/visits?date=2026-10-14`);
    expect(screen.getByRole("link", { name: "Next day" })).toHaveAttribute("href", `${BASE}/visits?date=2026-10-16`);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", `${BASE}/visits?date=2026-10-14`);
    cleanup();
    await show();
    expect(screen.queryByRole("link", { name: "Today" })).toBeNull(); // already today
  });
  it("has a date picker that asks for a day with a plain form (no script needed)", async () => {
    await show();
    const input = screen.getByLabelText("Pick a date");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveAttribute("name", "date");
    expect(input).toHaveValue(TODAY);
    const form = input.closest("form")!;
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", `${BASE}/visits`);
    expect(within(form).getByRole("button", { name: "Show" })).toBeInTheDocument();
  });
  it("lists the visits still to come first, in the order the API gave, and the finished ones under their own heading", async () => {
    await show();
    expect(screen.getByText("3 visits")).toBeInTheDocument();
    const articles = screen.getAllByRole("article").map((a) => a.querySelector("h3")!.textContent);
    expect(articles).toEqual(["Anita R. · Hyderabad", "Priya S. + 2 · Hyderabad", "Lakshmi Textiles + 2 · Hyderabad"]);
    expect(screen.getByRole("heading", { name: "Finished" })).toBeInTheDocument();
  });
  it("points at the visit it was asked to (the Ask box's link)", async () => {
    await show({ focus: VISIT_1 });
    expect(document.getElementById(`v-${VISIT_1}`)!.className).toContain("ring-2");
    expect(document.getElementById(`v-${VISIT_3}`)!.className).not.toContain("ring-2");
  });
  it("an empty day says so, and a day that has passed says it differently", async () => {
    await show({ visits: [] });
    expect(screen.getByText("No visits booked for this day yet.")).toBeInTheDocument();
    cleanup();
    await show({ visits: [], day: "2026-10-12" });
    expect(screen.getByText("No visits were booked for this day.")).toBeInTheDocument();
  });
  it("says 'Not available yet' in the place it could not read: the visits, the free times", async () => {
    await show({ visits: null, slots: null });
    expect(screen.getAllByText("Not available yet")).toHaveLength(2);
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("the Visits page: free times", () => {
  it("lists the free times still to come as links that open the booking on that time", async () => {
    await show({ slots: { ...slotsJson(TODAY), slots: slotsJson(TODAY).slots.map((s, i) => ({ ...s, free: i === 1 ? 0 : 2, past: i === 0 })) } });
    const section = document.querySelector('[data-part="free-times"]') as HTMLElement;
    const links = within(section).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", `${BASE}/visits?date=${TODAY}&time=11:00#book`);
    expect(links.map((l) => l.textContent).join(" ")).not.toMatch(/10:00|10:30/); // an earlier slot and a full slot are not offered
  });
  it("a closed day says why; a day with every time taken says so", async () => {
    await show({ slots: { ...slotsJson(TODAY), open: false, reason: "closed_date", slots: [] } });
    expect(within(document.querySelector('[data-part="free-times"]') as HTMLElement).getByText("The shop is closed on this date.")).toBeInTheDocument();
    cleanup();
    await show({ slots: { ...slotsJson(TODAY), slots: slotsJson(TODAY).slots.map((s) => ({ ...s, free: 0 })) } });
    expect(within(document.querySelector('[data-part="free-times"]') as HTMLElement).getByText("Every time left on this day is taken.")).toBeInTheDocument();
  });
  it("a time from the link opens the booking on it", async () => {
    const actions = fakeVisitsActions();
    await show({ time: "11:00", actions, lead: { leadId: LEAD_A, label: "Priya S." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Book the visit" })));
    expect(actions.book).toHaveBeenCalledWith(expect.objectContaining({ date: TODAY, slot: "11:00", leadId: LEAD_A }));
  });
  it("a time that is not free is ignored", async () => {
    await show({ time: "03:00" });
    expect(screen.getByRole("button", { name: "Book the visit" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^03:00/ })).toBeNull();
  });
});

describe("the Visits page: who sees what", () => {
  it.each(["owner", "admin", "sales"] as const)("%s can book and change", async (role) => {
    await show({ role });
    expect(screen.getByRole("heading", { name: "Book a visit" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Confirm" }).length).toBeGreaterThan(0);
  });
  it("a Viewer reads the day, with no booking and no buttons", async () => {
    await show({ role: "viewer" });
    expect(screen.queryByRole("heading", { name: "Book a visit" })).toBeNull();
    expect(screen.getByText(/You can look at the visits/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    const links = within(document.querySelector('[data-part="free-times"]') as HTMLElement).queryAllByRole("link");
    expect(links).toHaveLength(0); // the free times are not links to a booking
  });
  it("a step on a card calls the server with the workspace's action", async () => {
    const actions = fakeVisitsActions();
    await show({ actions });
    await act(async () => fireEvent.click(within(screen.getAllByRole("article")[0]).getByRole("button", { name: "Confirm" })));
    expect(actions.confirm).toHaveBeenCalledWith(VISIT_3);
  });
});

describe("the Visits page: the store hours tab", () => {
  it("shows the hours for the Owner to change", async () => {
    await show({ view: "hours" });
    expect(screen.getByRole("link", { name: "Store hours" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Opening hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save the hours" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Book a visit" })).toBeNull();
  });
  it("is read only for Sales and a Viewer", async () => {
    for (const role of ["sales", "viewer"] as const) {
      await show({ view: "hours", role });
      expect(screen.queryByRole("button", { name: "Save the hours" })).toBeNull();
      expect(screen.getByText("Only the owner or an admin can change the hours.")).toBeInTheDocument();
      cleanup();
    }
  });
  it("says 'Not available yet' when the hours cannot be read", async () => {
    await show({ view: "hours", hours: null });
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});

describe("the Visits page: the phone", () => {
  it("lays out as one column and the day bar wraps instead of scrolling sideways", async () => {
    await show();
    const grid = document.querySelector('[data-screen="visits"] .grid') as HTMLElement;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("lg:grid-cols-");
    const form = screen.getByLabelText("Pick a date").closest("form")!;
    expect(form.className).toContain("max-md:basis-full");
  });
});
