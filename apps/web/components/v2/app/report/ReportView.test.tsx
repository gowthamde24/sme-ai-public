import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReportData } from "@/lib/report/week";

import { ReportNoAccess, ReportView, minutesText } from "./ReportView";

afterEach(cleanup);

const range = { from: "2026-10-12", to: "2026-10-18", today: "2026-10-14" };
const full: ReportData = {
  range,
  visits: { booked: 8, arrived: 5, bought: 2, noShow: 1, cancelled: 1, perDay: [1, 2, 3, 0, 1, 1, 0], capped: false },
  messages: { sent: 12, waiting: 3, blocked: 1 },
  approval: { medianMinutes: 75, count: 6 },
  sarees: { top: [{ id: "a", name: "Kanchi Red", count: 4 }, { id: "b", name: "Mysore Blue", count: 1 }], unmatched: 2, withPhotos: 7, capped: false },
  aiPercent: 42,
};
const view = (data: ReportData, labels?: Record<string, string>, lang = "en") => render(<ReportView data={data} labels={labels} lang={lang} />);
const section = (name: string) => screen.getByRole("region", { name });

describe("This week", () => {
  it("has one h1, the week's days, and a card for each part", () => {
    view(full);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "This week" })).toBeInTheDocument();
    expect(screen.getByText(/Mon, 12 Oct to Sun, 18 Oct/)).toBeInTheDocument();
    for (const name of ["Store visits", "WhatsApp messages", "How fast you say OK", "Sarees sent most", "Agent OWL this week"]) expect(section(name)).toBeInTheDocument();
  });
  it("writes every visit number in words beside its bar, not by length alone", () => {
    view(full);
    const s = section("Store visits");
    for (const [label, n] of [["Booked", "8"], ["Came to the shop", "5"], ["Bought", "2"], ["Did not come", "1"], ["Cancelled", "1"]]) {
      const row = within(s).getByText(label).closest("li")!;
      expect(row).toHaveTextContent(n);
    }
  });
  it("draws the days as one image that says every value", () => {
    view(full);
    const chart = screen.getByRole("img", { name: /Visits booked each day, Monday first: Mon 1, Tue 2, Wed 3, Thu 0, Fri 1, Sat 1, Sun 0/ });
    expect(chart).toBeInTheDocument();
  });
  it("shows messages sent, waiting and blocked", () => {
    view(full);
    const s = section("WhatsApp messages");
    expect(within(s).getByText("Sent").closest("li")).toHaveTextContent("12");
    expect(within(s).getByText("Waiting for you").closest("li")).toHaveTextContent("3");
    expect(within(s).getByText("Blocked").closest("li")).toHaveTextContent("1");
  });
  it("writes the time to say OK in hours and minutes, and says what is not available yet", () => {
    view(full);
    const s = section("How fast you say OK");
    expect(s).toHaveTextContent("1 h 15 min");
    expect(s).toHaveTextContent(/Counted from 6 approved messages/);
    expect(s).toHaveTextContent(/customers hear back from you is not available yet/);
    expect(minutesText(undefined, 9)).toBe("9 min");
  });
  it("says one message, not 1 messages", () => {
    view({ ...full, approval: { medianMinutes: 5, count: 1 }, sarees: { top: [], unmatched: 1, withPhotos: 1, capped: false } });
    expect(section("How fast you say OK")).toHaveTextContent("Counted from 1 approved message.");
    expect(section("Sarees sent most")).toHaveTextContent("1 sent message had photos");
  });
  it("lists the sarees with their count and says what could not be matched", () => {
    view(full);
    const s = section("Sarees sent most");
    expect(within(s).getByText("Kanchi Red").closest("li")).toHaveTextContent("4 times");
    expect(within(s).getByText("Mysore Blue").closest("li")).toHaveTextContent("1 time");
    expect(s).toHaveTextContent(/2 sent messages had photos we could not match/);
  });
  it("shows the AI use as a percentage with a meter", () => {
    view(full);
    expect(screen.getByRole("meter", { name: "Agent OWL usage this week: 42% used" })).toHaveAttribute("aria-valuenow", "42");
    expect(section("Agent OWL this week")).toHaveTextContent("42% used");
  });
  it("shows an empty week with the owl and words, never a made-up number", () => {
    view({ ...full, visits: { booked: 0, arrived: 0, bought: 0, noShow: 0, cancelled: 0, perDay: [0, 0, 0, 0, 0, 0, 0], capped: false }, messages: { sent: 0, waiting: 0, blocked: 0 }, approval: null, sarees: { top: [], unmatched: 0, withPhotos: 0, capped: false } });
    expect(section("Store visits")).toHaveTextContent("No visits booked this week yet.");
    expect(section("WhatsApp messages")).toHaveTextContent("No messages this week yet.");
    expect(section("How fast you say OK")).toHaveTextContent("No message you approved was sent this week yet.");
    expect(section("Sarees sent most")).toHaveTextContent("No saree photos were sent this week yet.");
  });
  it("a part that could not be read says so in its own card and draws no zero", () => {
    view({ ...full, visits: "error", messages: "error", approval: "error", sarees: "error", aiPercent: "error" });
    expect(screen.getAllByRole("status")).toHaveLength(5);
    expect(screen.queryByRole("meter")).toBeNull();
    expect(section("Store visits")).not.toHaveTextContent(/\b0\b/);
  });
  it("says when a list was cut short", () => {
    view({ ...full, visits: { ...(full.visits as Exclude<ReportData["visits"], "error">), capped: true }, sarees: { ...(full.sarees as Exclude<ReportData["sarees"], "error">), capped: true } });
    expect(section("Store visits")).toHaveTextContent(/first 300 visits/);
    expect(section("Sarees sent most")).toHaveTextContent(/first 300 sent messages/);
  });
  it("speaks the person's language from the labels and the day names", () => {
    view(full, { "report.title": "ఈ వారం", "report.visits.title": "షాప్ విజిట్లు" }, "te");
    expect(screen.getByRole("heading", { level: 1, name: "ఈ వారం" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "షాప్ విజిట్లు" })).toBeInTheDocument();
  });
  it("shows no customer's name and no money", () => {
    const { container } = view(full);
    expect(container.textContent).not.toMatch(/₹|Rs\.?\s?\d/);
  });
});

describe("the page for someone who is not an owner or admin", () => {
  it("says so kindly, with a way forward", () => {
    render(<ReportNoAccess labels={undefined} />);
    expect(screen.getByRole("heading", { name: "This page is for the owner and admins" })).toBeInTheDocument();
    expect(screen.getByText(/Ask the owner/)).toBeInTheDocument();
  });
});
