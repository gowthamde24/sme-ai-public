import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NO_COUNTS } from "@/lib/nav-counts";

import { NavGroups } from "./NavGroups";
import { menuGroups, type PackFrame } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
const TEXTILES: PackFrame = { name: "Textiles", accent: "rose_silk", validated: true, coreTab: "quotes", modules: ["today", "enquiries", "quotes", "orders", "visits", "office", "contacts", "catalogue", "inbox", "reports", "integrations", "lead_finder"], labels: {} };
const COUNTS = { ...NO_COUNTS, needsYou: 3, prospectsNeedingOwner: 2, newLeads: 12, liveCalls: 1, unreadChats: 2, followupsDue: 120, visitsToday: 2, quotesWaiting: 1, aiTeamWorking: 4 };
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const badge = (row: string) => document.querySelector(`[data-nav-badge="${row}"]`)?.textContent ?? null;

describe("NavGroups (sidebar v2)", () => {
  it("draws the five groups with their headings, real line icons and the current row marked", () => {
    render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-quotes"  />);
    for (const name of ["Overview", "Sell", "Business", "AI team", "Setup"]) expect(screen.getByRole("group", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quotes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Quotes" })).toHaveAttribute("href", `/app/tenants/${T}/quotes`);
    expect(screen.getByRole("link", { name: "Catalogue & stock" })).toBeInTheDocument();
    expect(document.querySelectorAll("svg[data-icon] use").length).toBeGreaterThan(10);
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });
  it("shows each row's number from the nav counts: Today adds the Lead Finder's businesses; words where the design has them; 99+ due", () => {
    render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today" counts={COUNTS}  />);
    expect([badge("m-today"), badge("m-leads"), badge("m-calls"), badge("m-chats"), badge("m-followups"), badge("m-visits"), badge("m-quotes"), badge("m-aiteam")]).toEqual(["5", "12 new", "1 live", "2", "99+ due", "2 today", "1", "4 working"]);
  });
  it("draws no badge before the counts arrive, for a 0 or for a null (not known or not for you); Today falls back to the frame's own count", () => {
    const { rerender } = render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today"  />);
    expect(document.querySelectorAll("[data-nav-badge]")).toHaveLength(0);
    rerender(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today" waiting={4}  />);
    expect(badge("m-today")).toBe("4");
    rerender(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today" counts={{ ...COUNTS, liveCalls: 0, newLeads: null }}  />);
    expect(badge("m-calls")).toBeNull();
    expect(badge("m-leads")).toBeNull();
  });
  it("a heading folds its group (remembered), but never the group of the current page", () => {
    const { unmount } = render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today"  />);
    const business = screen.getByRole("group", { name: "Business" });
    fireEvent.click(within(business).getByRole("button", { name: "Business" }));
    expect(within(business).queryByRole("link")).toBeNull();
    expect(within(business).getByRole("button", { name: "Business" })).toHaveAttribute("aria-expanded", "false");
    unmount();
    render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-today"  />);
    expect(within(screen.getByRole("group", { name: "Business" })).queryByRole("link")).toBeNull();
    cleanup();
    render(<NavGroups groups={menuGroups("owner", TEXTILES)} tenantId={T} activeItemId="m-orders"  />);
    expect(within(screen.getByRole("group", { name: "Business" })).getByRole("link", { name: "Orders" })).toBeInTheDocument();
  });
  it("the business type's own word wins (a school's Campus visits); the narrow rail keeps the words for a screen reader and a tooltip", () => {
    const school: PackFrame = { ...TEXTILES, modules: ["today", "visits", "fees", "programmes", "office"], labels: { "nav.item.visits": "Campus visits" } };
    render(<NavGroups groups={menuGroups("owner", school)} tenantId={T} activeItemId={null} own={{ "nav.item.visits": "Campus visits" }} collapsed counts={COUNTS} />);
    expect(screen.getByRole("link", { name: /Campus visits/ })).toHaveAttribute("title", "Campus visits");
    expect(screen.queryByRole("button", { name: "Sell" })).toBeNull();
    expect(document.querySelector('[data-nav-badge="m-visits"]')).toHaveTextContent("2 today");
  });
});
