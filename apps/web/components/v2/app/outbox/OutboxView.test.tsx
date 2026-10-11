import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { schedulerStatusFor } from "./outbox-test-kit";
import { OutboxView, type OutboxViewProps } from "./OutboxView";
import { BASE, HELD, NOW, STOPPED, WAITING, WORDS, fakeOutboxActions } from "./outbox-test-kit";

const props = (over: Partial<OutboxViewProps> = {}): OutboxViewProps => ({
  tab: "waiting", range: "7d", q: "", role: "owner", now: NOW, lang: "en", base: BASE, words: WORDS, items: [WAITING()], waiting: 1, more: null,
  settings: { platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 3 }, scheduler: schedulerStatusFor({}), actions: fakeOutboxActions(), ...over,
});
const show = async (over: Partial<OutboxViewProps> = {}) => {
  await act(async () => void render(<OutboxView {...props(over)} />));
};
afterEach(cleanup);

describe("the Outbox page: tabs", () => {
  it("has the title and the four tabs as links that keep the filters; the current one is marked", async () => {
    await show({ tab: "scheduled", range: "today", q: "Lakshmi" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Outbox");
    const nav = screen.getByRole("navigation", { name: "Outbox" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Waiting for you11 waiting for you", "Scheduled", "Sent", "Blocked"]);
    expect(within(nav).getByRole("link", { name: /Scheduled/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Sent/ })).toHaveAttribute("href", `${BASE}/outbox?tab=sent&range=today&q=Lakshmi`);
  });
  it("shows how many wait for a person on the first tab (100 or more says so), and nothing for none", async () => {
    await show({ waiting: 100 });
    expect(screen.getByText("100+")).toBeInTheDocument();
    cleanup();
    await show({ waiting: 0 });
    expect(screen.queryByText("0")).toBeNull();
    cleanup();
    await show({ waiting: null });
    expect(screen.getByRole("link", { name: "Waiting for you" })).toBeInTheDocument();
  });
  it("tabs are at least 44 px high and on a phone all four are in view (two by two), never hidden in a sideways scroll", async () => {
    await show();
    const nav = screen.getByRole("navigation", { name: "Outbox" });
    expect(nav.className).toContain("grid-cols-2");
    expect(nav.className).not.toContain("overflow-x-auto");
    expect(within(nav).getByRole("link", { name: /Sent/ }).className).toContain("min-h-11");
  });
});

describe("the Outbox page: filters", () => {
  it("a plain GET form with the day range and the customer search, keeping the tab", async () => {
    await show({ tab: "sent", range: "today", q: "Lak" });
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", `${BASE}/outbox`);
    expect(form.querySelector('input[name="tab"]')).toHaveValue("sent");
    expect(within(form).getByLabelText("Show")).toHaveValue("today");
    expect(within(form).getAllByRole("option").map((o) => o.textContent)).toEqual(["Today", "Last 7 days"]);
    expect(within(form).getByLabelText("Customer")).toHaveValue("Lak");
    expect(within(form).getByRole("button", { name: "Show" })).toBeInTheDocument();
  });
  it("'Clear' appears only when a filter is on", async () => {
    await show();
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
    cleanup();
    await show({ q: "x" });
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", `${BASE}/outbox?tab=waiting`);
    cleanup();
    await show({ range: "today" });
    expect(screen.getByRole("link", { name: "Clear" })).toBeInTheDocument();
  });
  it("an older page has a link that keeps the tab and filters", async () => {
    await show({ more: "abc", q: "x" });
    expect(screen.getByRole("link", { name: "Older messages" })).toHaveAttribute("href", `${BASE}/outbox?tab=waiting&range=7d&q=x&after=abc`);
  });
});

describe("the Outbox page: the kill switch and automatic sending", () => {
  it("a clear banner when sending is stopped for the whole system", async () => {
    await show({ settings: { platform_switch_on: false, auto_send_enabled: true, per_customer_daily_limit: 3 } });
    const banner = document.querySelector('[data-banner="sending-stopped"]') as HTMLElement;
    expect(banner).toHaveTextContent("Sending is stopped");
    expect(banner).toHaveTextContent("Nothing goes out and everything waits until the operator switches sending back on.");
  });
  it("no banner when sending is on, and none for what could not be read", async () => {
    await show();
    expect(document.querySelector('[data-banner="sending-stopped"]')).toBeNull();
    cleanup();
    await show({ settings: null });
    expect(document.querySelector('[data-banner="sending-stopped"]')).toBeNull();
  });
  it("a calm note when this business has automatic sending off, with the way to Settings for the Owner only", async () => {
    const settings = { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3 };
    await show({ settings });
    expect(document.querySelector('[data-note="auto-off"]')).toHaveTextContent("Automatic sending is off for this business: new messages wait for you to approve them. Messages you approve still go out.");
    expect(screen.getByRole("link", { name: "Change it in Settings" })).toHaveAttribute("href", `${BASE}/settings?section=agent`);
    cleanup();
    await show({ settings, role: "admin" });
    expect(screen.queryByRole("link", { name: "Change it in Settings" })).toBeNull();
  });
});

describe("the Outbox page: Agent OWL's last check", () => {
  it("says when it last checked and when it checks next", async () => {
    await show({ scheduler: schedulerStatusFor({ next_run_at: "2026-10-14T04:31:00Z" }) });
    expect(document.querySelector('[data-scheduler="calm"]')).toHaveTextContent("Agent OWL last checked 2 min ago · next check 10:01");
    cleanup();
    await show(); // the next check is already due (04:29 is behind 04:30): no time is invented
    expect(document.querySelector('[data-scheduler="calm"]')).toHaveTextContent(/^Agent OWL last checked 2 min ago$/);
  });
  it("says 'just now' inside the first minute", async () => {
    await show({ scheduler: schedulerStatusFor({ last_run_at: "2026-10-14T04:29:40Z" }) });
    expect(document.querySelector('[data-scheduler="calm"]')).toHaveTextContent("Agent OWL checked just now");
  });
  it("a calm warning when it has not checked for more than five minutes while it should", async () => {
    await show({ scheduler: schedulerStatusFor({ last_run_at: "2026-10-14T04:20:00Z" }) });
    const w = document.querySelector('[data-scheduler="stale"]') as HTMLElement;
    expect(w).toHaveTextContent("Agent OWL has not checked for 10 minutes. Messages held for 9:00 and visit reminders may be late.");
    expect(w).toHaveAttribute("role", "status");
  });
  it("no warning when its automatic work is off: it says why instead", async () => {
    await show({ scheduler: schedulerStatusFor({ last_run_at: "2026-10-14T00:00:00Z", auto_send_enabled: false, active: false }) });
    expect(document.querySelector('[data-scheduler="stale"]')).toBeNull();
    expect(document.querySelector('[data-scheduler="calm"]')).toHaveTextContent("automatic sending is off for this business");
  });
  it("never heard from, and not drawn for Sales or when it could not be read", async () => {
    await show({ scheduler: schedulerStatusFor({ last_run_at: null, next_run_at: null, worker_running: false }) });
    expect(document.querySelector('[data-scheduler="never"]')).toHaveTextContent("Agent OWL has not checked yet.");
    cleanup();
    await show({ role: "sales" });
    expect(document.querySelector("[data-scheduler]")).toBeNull();
    cleanup();
    await show({ scheduler: null });
    expect(document.querySelector("[data-scheduler]")).toBeNull();
  });
});

describe("the Outbox page: the list", () => {
  it("draws the rows of the tab", async () => {
    await show({ tab: "blocked", items: [STOPPED()] });
    expect(screen.getByText("Customer said STOP")).toBeInTheDocument();
    cleanup();
    await show({ tab: "scheduled", items: [HELD()] });
    expect(screen.getByText("Quiet hours")).toBeInTheDocument();
  });
  it("says 'Not available yet' when the list could not be read, and draws no row", async () => {
    await show({ items: null });
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
  it("an empty tab has the happy owl", async () => {
    await show({ items: [], tab: "sent", waiting: 0 });
    expect(document.querySelector('[data-empty="sent"] svg')).not.toBeNull();
  });
});
