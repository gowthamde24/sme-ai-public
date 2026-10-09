import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appT } from "@/i18n/app";

import { TodayView, ago } from "./TodayView";
import { NOTHING_TODAY, type NeedsYouItem, type TodayData } from "./types";

const en = appT("en");
const t = (k: string, v?: Record<string, string | number>) => en(k as "frame.notyet", v);
const NOW = new Date("2026-10-09T10:00:00Z").getTime();
const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const item = (over: Partial<NeedsYouItem>): NeedsYouItem => ({ kind: "quote_approval", id: "q1", customer: "SYNTHETIC Textiles", city: "Hyderabad", agent: "Quote Writer", summary: "A quote draft is ready.", at: at(28), amount_paise: 14175000, href: "/app/tenants/T/enquiries/E", ...over });
const full: TodayData = {
  cards: { waiting: 3, money_held_paise: 782000, orders_open: 2 },
  needs_you: [item({}), item({ kind: "followup_due", id: "f1", city: null, amount_paise: null, href: "/app/tenants/T/leads/L/followup" }), item({ kind: "order_money_held", id: "o1", href: "/app/tenants/T/orders/O" })],
  recent: [{ kind: "x", order_ref: "ORD-1", customer: "SYNTHETIC Silks", text: "Dispatched", at: at(2000), href: null }],
  team: [{ agent: "Main agent", state: "idle", job: null, last_event: null }, { agent: "Lead Finder", state: "working", job: "Reading a directory", last_event: null }, { agent: "Order Desk", state: "not_available", job: null, last_event: null }],
};
const view = (data: TodayData, name: string | null = "Asha", hour = 9) => render(<TodayView data={data} name={name} hour={hour} base="/app/tenants/T" t={t} />);
afterEach(cleanup);

describe("ago", () => {
  it("is short and needs no words", () => {
    expect([ago(at(0.2), NOW), ago(at(28), NOW), ago(at(180), NOW), ago(at(3000), NOW)]).toEqual(["1m", "28m", "3h", "2d"]);
  });
});

describe("TodayView", () => {
  it("greets by the hour and by name, and says how many things wait", () => {
    view(full, "Asha", 9);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning, Asha");
    expect(screen.getByText("3 things are waiting for you.")).toBeInTheDocument();
    cleanup();
    view(full, null, 14);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Good afternoon$/);
    cleanup();
    view({ ...full, cards: { ...full.cards, waiting: 1 } }, "Asha", 20);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Asha");
    expect(screen.getByText("1 thing is waiting for you.")).toBeInTheDocument();
  });
  it("draws one card per item with one main button (the first in the main colour) and Open, both to the page that decides", () => {
    view(full);
    const needs = screen.getByRole("heading", { name: "Needs you" }).closest("section")!;
    const articles = within(needs).getAllByRole("article");
    expect(articles).toHaveLength(3);
    const first = articles[0];
    expect(within(first).getByRole("heading", { level: 3 })).toHaveTextContent("SYNTHETIC Textiles, Hyderabad");
    expect(within(first).getByText("Quote draft")).toBeInTheDocument();
    expect(within(first).getByText("₹1,41,750.00")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Check the quote" })).toHaveAttribute("href", "/app/tenants/T/enquiries/E");
    expect(within(first).getByRole("link", { name: "Check the quote" }).className).toContain("bg-brand");
    expect(within(first).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/app/tenants/T/enquiries/E");
    expect(within(first).getByText("Nothing is sent, approved or recorded by opening this.")).toBeInTheDocument();
    expect(within(articles[1]).getByRole("link", { name: "Check the follow-up" }).className).not.toContain("bg-brand ");
    expect(within(articles[1]).queryByText("City")).toBeNull(); // no city: no fact is invented
    expect(within(articles[2]).getByRole("link", { name: "Check the order" })).toHaveAttribute("href", "/app/tenants/T/orders/O");
    expect(within(articles[2]).getByText("Order: money still held")).toBeInTheDocument();
  });
  it("says 'Not available yet' in place of every part that is null, and shows no number it was not given", () => {
    view(NOTHING_TODAY, null);
    expect(screen.queryByText(/things are waiting/)).toBeNull();
    expect(screen.getAllByText("Not available yet")).toHaveLength(6); // three cards, Needs you, the team, Recently recorded
    expect(screen.queryByText(/₹/)).toBeNull();
  });
  it("an empty list is 'nothing is waiting', not 'not available'", () => {
    view({ ...full, cards: { ...full.cards, waiting: 0 }, needs_you: [] });
    expect(screen.getAllByText("Nothing is waiting for you.").length).toBeGreaterThan(0);
  });
  it("lists the agents with their state and the last job, and the recent records, linked to the orders", () => {
    view(full);
    const team = screen.getByRole("heading", { name: "Your team right now" }).closest("section")!;
    expect(within(team).getByText("Working")).toBeInTheDocument();
    expect(within(team).getByText("Reading a directory")).toBeInTheDocument();
    expect(within(team).getAllByText("Not available yet")).toHaveLength(1); // the agent that does not exist yet
    expect(within(team).getByRole("link", { name: /Office/ })).toHaveAttribute("href", "/app/tenants/T/office");
    const recent = screen.getByRole("heading", { name: "Recently recorded" }).closest("section")!;
    expect(within(recent).getByRole("link", { name: /ORD-1 · SYNTHETIC Silks/ })).toHaveAttribute("href", "/app/tenants/T/orders");
  });
  it("the money card links to the orders and is the amber one", () => {
    view(full);
    const money = screen.getByRole("link", { name: /Customer money held/ });
    expect(money).toHaveAttribute("href", "/app/tenants/T/orders");
    expect(money).toHaveTextContent("₹7,820.00");
  });
});
