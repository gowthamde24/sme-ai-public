import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { V2Root } from "@/components/v2/V2Root";
import { MENU_V6, activeV6Id, menuGroupsV6 } from "@/components/v2/app/nav";

import { NavGroups } from "../NavGroups";
import { EmptyNext } from "./EmptyNext";
import { STATUSES, StatusPill } from "./StatusPill";

afterEach(cleanup);

describe("V2Root and the design system v6", () => {
  it("writes data-ds=6 only when asked", () => {
    const { container } = render(<V2Root ds>x</V2Root>);
    expect(container.querySelector('[data-ui="v2"]')).toHaveAttribute("data-ds", "6");
    cleanup();
    const off = render(<V2Root>x</V2Root>);
    expect(off.container.querySelector('[data-ui="v2"]')).not.toHaveAttribute("data-ds");
  });
});

describe("the status pill", () => {
  it("is one of six statuses, each with its word, a dot and its own data-status (the colours are ds.css's)", () => {
    expect(STATUSES).toEqual(["completed", "transferred", "no_answer", "rejected", "spam", "live"]);
    render(
      <ul>
        {STATUSES.map((s) => (
          <li key={s}>
            <StatusPill status={s}>{s.replace("_", " ")}</StatusPill>
          </li>
        ))}
      </ul>,
    );
    for (const s of STATUSES) expect(document.querySelector(`[data-status="${s}"]`)).toHaveTextContent(s.replace("_", " "));
    expect(document.querySelectorAll("[data-dot]")).toHaveLength(6);
  });
});

describe("an empty page shows its next step", () => {
  it("a title, a sentence and ONE button", () => {
    render(<EmptyNext title="No calls yet" text="Make a test call to see how your assistant answers." action={{ href: "/app/tenants/T/calls/test", label: "Make a test call" }} />);
    expect(screen.getByRole("heading", { name: "No calls yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a test call" })).toHaveAttribute("href", "/app/tenants/T/calls/test");
  });
});

describe("the v6 side menu (owner, 13 Nov 2026)", () => {
  const owner = menuGroupsV6("owner");
  it("is Today, My assistant, Calls, Chats, Leads, Campaigns, Reports, then Setup: Catalogue, Phone numbers, Billing", () => {
    expect(MENU_V6.map((g) => [g.label, g.rows.map((r) => r.label)])).toEqual([
      ["", ["Today", "My assistant", "Calls", "Chats", "Leads", "Campaigns", "Reports"]],
      ["Setup", ["Catalogue", "Phone numbers", "Billing", "Settings"]],
    ]);
    const drawn = owner.map((g) => [g.label, g.items.map((i) => i.label)]);
    expect(drawn[0][0]).toBe("");
    expect(drawn[1]).toEqual(["Setup", expect.arrayContaining(["Phone numbers", "Billing", "Settings"])]);
    expect(owner[0].items.slice(0, 2).map((i) => i.label)).toEqual(["Today", "My assistant"]);
  });
  it("names no assistant: the row says 'My assistant'", () => {
    const text = JSON.stringify(MENU_V6);
    expect(text).not.toMatch(/Vijaya|Asha|OWL|Ramya/);
  });
  it("My assistant opens its own page and carries the status; Billing is the Owner's and Admin's", () => {
    const mine = owner.flatMap((g) => g.items).find((i) => i.id === "v6-myassistant");
    expect(mine?.path).toBe("/my-assistant");
    expect(mine?.status).toBe("assistant");
    expect(menuGroupsV6("sales").flatMap((g) => g.items).map((i) => i.id)).not.toContain("v6-billing");
    expect(menuGroupsV6("sales").flatMap((g) => g.items).find((i) => i.id === "v6-myassistant")?.path).toBe("/ai-team"); // a salesperson sees the team's page, not the settings of the assistant
  });
  it("the marker follows the page: Train how it talks is under My assistant; Plans is under Billing; Phone calls under Calls", () => {
    const at = (rest: string) => activeV6Id(owner, `/app/tenants/22222222-2222-4222-8222-222222222222${rest}`, null);
    expect(at("/ai-team/training")).toBe("v6-myassistant");
    expect(at("/my-assistant")).toBe("v6-myassistant");
    expect(at("/plans")).toBe("v6-billing");
    expect(at("/billing")).toBe("v6-billing");
    // Phone calls is a page of app v4 (the feature `app_v4`), so Calls is drawn where that is on
    const withV4 = menuGroupsV6("owner", { modules: ["enquiries", "inbox", "orders", "quotes", "visits", "reports"], features: ["app_v4"] } as unknown as Parameters<typeof menuGroupsV6>[1]);
    expect(activeV6Id(withV4, "/app/tenants/22222222-2222-4222-8222-222222222222/calls", null)).toBe("v6-calls");
    expect(at("")).toBe("v6-today");
  });
});

describe("the status chip on My assistant", () => {
  const groups = menuGroupsV6("owner");
  const draw = (assistant: "not_live" | "in_training" | "live" | null) =>
    render(<NavGroups design groups={groups} tenantId="22222222-2222-4222-8222-222222222222" activeItemId="v6-today" labels={{}} assistant={assistant} />);
  it.each([
    ["not_live", "Not live"],
    ["in_training", "In training"],
    ["live", "Live"],
  ] as const)("%s shows %s", (state, text) => {
    draw(state);
    expect(document.querySelector('[data-nav-row="v6-myassistant"] [data-nav-badge]')).toHaveTextContent(text);
  });
  it("no state, no chip", () => {
    draw(null);
    expect(document.querySelector('[data-nav-row="v6-myassistant"] [data-nav-badge]')).toBeNull();
  });
});

import { PageHeader } from "./PageHeader";

describe("the page header", () => {
  it("the title is the H1, the line is under it, the main action is on the right", () => {
    render(<PageHeader title="Calls" sub="Every call, newest first." right={<button type="button">Test call</button>} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Calls");
    expect(screen.getByText("Every call, newest first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test call" })).toBeInTheDocument();
  });
});

import { BalanceBox } from "./BalanceBox";
import { v6PagesOf } from "@/components/v2/app/nav";

describe("the money box of the side menu (owner, 13 Nov 2026): the rupee balance and what it buys, with Top up", () => {
  const T = "22222222-2222-4222-8222-222222222222";
  it("says ₹1,550 · about 310 call minutes, Top up and Plan & usage go to Billing, never 'credits', and there are no old meters", () => {
    render(<BalanceBox balance={{ text: "₹1,550", low: false, minutes: 310 }} tenantId={T} labels={{}} />);
    const box = document.querySelector('[data-part="balance-box"]') as HTMLElement;
    expect(box).toHaveTextContent("₹1,550 · about 310 call minutes");
    expect(screen.getByRole("link", { name: "Top up" })).toHaveAttribute("href", `/app/tenants/${T}/billing`);
    expect(screen.getByRole("link", { name: "Plan & usage" })).toHaveAttribute("href", `/app/tenants/${T}/billing`);
    expect(box.textContent).not.toMatch(/credit|AI usage|Call minutes \d/i);
  });
  it("a low balance is red; no balance says nothing about money but keeps the links", () => {
    render(<BalanceBox balance={{ text: "₹40", low: true, minutes: null }} tenantId={T} labels={{}} />);
    expect(document.querySelector('[data-part="balance-amount"]')).toHaveClass("text-red-text");
    cleanup();
    render(<BalanceBox balance={null} tenantId={T} labels={{}} />);
    expect(document.querySelector('[data-part="balance-amount"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Top up" })).toBeInTheDocument();
  });
});

describe("one tab row at most per page (owner, 13 Nov 2026)", () => {
  const view = { modules: ["enquiries", "inbox", "orders", "quotes", "visits", "reports", "campaigns"], features: ["app_v4", "outreach", "leads", "tasks"] } as unknown as Parameters<typeof menuGroupsV6>[1];
  const rows = menuGroupsV6("owner", view).flatMap((g) => g.items);
  it("Calls is its own page (Phone calls only); Campaigns is its own row holding the lead plans, campaigns, call list and tasks", () => {
    expect(v6PagesOf(rows.find((r) => r.id === "v6-calls")!).map((p) => p.id)).toEqual(["phonecalls"]);
    expect(v6PagesOf(rows.find((r) => r.id === "v6-campaigns")!).map((p) => p.id)).toEqual(expect.arrayContaining(["outreach", "calllist", "tasks"]));
  });
  it("a page of the old Calls tabs (the call list, tasks) now belongs to Campaigns", () => {
    const at = (rest: string) => activeV6Id(menuGroupsV6("owner", view), `/app/tenants/22222222-2222-4222-8222-222222222222${rest}`, null);
    expect(at("/call-list")).toBe("v6-campaigns");
    expect(at("/tasks")).toBe("v6-campaigns");
    expect(at("/calls")).toBe("v6-calls");
  });
});
