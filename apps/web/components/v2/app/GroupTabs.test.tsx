import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/orders", search: "" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ refresh: vi.fn() }) }));

import { otherPackIds, workspacePack } from "@/lib/packs/pack-test-kit";
import { packFrame } from "@/lib/packs/resolve";

import { NO_FRAME_DATA } from "./contract";
import { GroupTabs } from "./GroupTabs";
import type { Membership } from "./use-workspace";

const A = "22222222-2222-2222-2222-222222222222";
const only = (role: Membership["role"]): Membership[] => [{ id: A, name: "Acme", role }];
const draw = (role: Membership["role"], pack = NO_FRAME_DATA.pack) => render(<GroupTabs memberships={only(role)} frame={{ ...NO_FRAME_DATA, pack }} />);
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of this section" })).getAllByRole("link");

beforeEach(() => {
  nav.pathname = `/app/tenants/${A}/orders`;
  nav.search = "";
});
afterEach(cleanup);

describe("the tabs of a menu row (sidebar v2)", () => {
  it("Leads: Leads and Customers, the page we are on marked, every tab a plain link inside the workspace", () => {
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=companies";
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Leads", "Customers"]);
    expect(tabs().map((a) => a.getAttribute("href"))).toEqual([`/app/tenants/${A}/review`, `/app/tenants/${A}?tab=companies`]);
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  });
  it("is the same strip on every page of the row: Chats, Catalogue, Phone number, Settings", () => {
    nav.pathname = `/app/tenants/${A}/outbox`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Customer chats", "Outbox", "Templates"]);
    cleanup();
    nav.pathname = `/app/tenants/${A}/price-list`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Products", "Price lists"]);
    cleanup();
    nav.pathname = `/app/tenants/${A}/integrations`;
    draw("owner");
    expect(tabs().map((a) => a.textContent)).toEqual(["Phone number", "Integrations"]);
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
    cleanup();
    nav.pathname = `/app/tenants/${A}/team`;
    draw("sales");
    expect(tabs().map((a) => a.textContent)).toEqual(["Settings", "Team"]);
  });
  it("is not drawn when the row has only one page for this role (Today, Orders, Reports), or on a page no row holds", () => {
    for (const p of ["", "/orders", "/report", "/help"]) {
      nav.pathname = `/app/tenants/${A}${p}`;
      draw("owner");
      expect(screen.queryByRole("navigation"), p).toBeNull();
      cleanup();
    }
  });
  it("a business type brings its own words into the tabs (a school: its words for Leads and Customers)", () => {
    const school = otherPackIds().find((i) => workspacePack(i).coreTab === "fees")!;
    const frame = packFrame(workspacePack(school, "signup"), "en");
    nav.pathname = `/app/tenants/${A}`;
    nav.search = "tab=companies";
    draw("owner", frame);
    const names = tabs().map((a) => a.textContent);
    expect(names).toContain(frame.labels["nav.item.customers"] ?? "Customers");
    expect(names).not.toContain("Quotes");
  });
});

describe("app v4: the sections of the page's group, above its own tabs (job-app-v4.md part 1)", () => {
  const v4 = (role: Membership["role"]) => render(<GroupTabs memberships={only(role)} frame={{ ...NO_FRAME_DATA, v4: true }} />);
  // the five groups' sections (up to 1023 px); the desktop's own row is `v4d-sections`
  const sections = () => within(document.querySelector('[data-frame="v4-sections"] nav') as HTMLElement).getAllByRole("link");
  const desktopSections = () => within(document.querySelector('[data-frame="v4d-sections"] nav') as HTMLElement).getAllByRole("link");
  const pageTabs = () => screen.queryAllByRole("navigation").filter((n) => !n.closest('[data-frame^="v4"]'));
  it("a Follow-ups page shows Customers' sections, Follow-ups marked, each a plain link to its own first page", () => {
    nav.pathname = `/app/tenants/${A}/followups`;
    v4("owner");
    const links = sections();
    expect(links.map((a) => a.textContent)).toEqual(["Leads", "Calls", "Chats", "Follow-ups", "Store visits", "Find customers"].filter((x) => links.some((a) => a.textContent === x)));
    expect(links.find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Follow-ups");
    for (const a of links) expect(a.getAttribute("href")).toMatch(new RegExp(`^/app/tenants/${A}`));
  });
  it("a Quotes page shows Sales' sections; without v4 the same page has no sections row", () => {
    nav.pathname = `/app/tenants/${A}/quotes`;
    v4("owner");
    expect(sections().map((a) => a.textContent)).toContain("Quotes");
    cleanup();
    draw("owner");
    expect(document.querySelector('[data-frame^="v4"]')).toBeNull();
  });
  it("on a desktop (1024 px and up) the menu row's own pages are the sections: Leads, Follow-ups and Store visits; the narrow row is hidden there, the desktop row below", () => {
    nav.pathname = `/app/tenants/${A}/followups`;
    v4("owner");
    expect(desktopSections().map((a) => a.textContent)).toEqual(["Leads", "Follow-ups", "Store visits"]);
    expect(desktopSections().find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Follow-ups");
    expect(document.querySelector('[data-frame="v4d-sections"]')?.className).toMatch(/hidden lg:block/);
    expect(document.querySelector('[data-frame="v4-sections"]')?.className).toContain("lg:hidden");
  });
  it("AI team's row holds Train how it talks and Phone number as its tabs; a row with one page has no desktop sections", () => {
    nav.pathname = `/app/tenants/${A}/ai-team/training`;
    v4("owner");
    expect(desktopSections().map((a) => a.textContent)).toEqual(["My AI team", "Train how it talks", "Phone number"]);
    expect(desktopSections().find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Train how it talks");
    cleanup();
    nav.pathname = `/app/tenants/${A}/quotes`;
    v4("owner");
    expect(document.querySelector('[data-frame="v4d-sections"]')).toBeNull();
  });
  it("one customer's own page (part 3) shows the sections, Leads marked, and no page tabs", () => {
    nav.pathname = `/app/tenants/${A}/customers/22222222-2222-4222-8222-222222222222`;
    v4("owner");
    expect(sections().find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Leads");
    expect(desktopSections().find((a) => a.getAttribute("aria-current") === "page")?.textContent).toBe("Leads");
    expect(pageTabs()).toHaveLength(0);
    cleanup();
    nav.pathname = `/app/tenants/${A}/customers/new`;
    v4("owner");
    expect(pageTabs().length).toBe(1);
    cleanup();
    // one call's page (part 4): the sections only, too
    nav.pathname = `/app/tenants/${A}/calls/33333333-3333-4333-8333-333333333333`;
    v4("owner");
    expect(pageTabs()).toHaveLength(0);
  });
});

describe("the design system v6: Today draws no tab row (the final Today design)", () => {
  it("the Today page has no 'Today / Talk to assistant' row, so the band comes first; another row with several pages keeps its tabs", () => {
    nav.pathname = `/app/tenants/${A}`;
    const { container, unmount } = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
    expect(container.querySelector('[data-frame="group-tabs"]')).toBeNull();
    unmount();
    nav.pathname = `/app/tenants/${A}/leads`;
    const again = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
    expect(again.container.querySelector('[data-tabs="v6"]')).not.toBeNull();
  });
  it("Leads (product audit): 'Add leads' is not a tab (the big button does it), Map sits under More, Find customers is a tab, an open page is always a tab (tabs-more.test.ts)", () => {
    nav.pathname = `/app/tenants/${A}/leads`;
    const { container, unmount } = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
    const tabs = [...container.querySelectorAll('[data-tabs="v6"] nav a')].map((a) => a.textContent);
    expect(tabs).not.toContain("Add leads");
    expect(tabs).not.toContain("Map");
    // Find customers is a tab (its word, "Find customers", comes from the frame: frame-data.test.ts)
    expect([...container.querySelectorAll('[data-tabs="v6"] nav a')].some((a) => a.getAttribute("href")?.endsWith("/retailers"))).toBe(true);
    unmount();
  });
  it("the My assistant row (owner, 18 Nov): the first tab says Overview, the menu says My assistant, and no two tabs share a name", () => {
    nav.pathname = `/app/tenants/${A}/ai-team`;
    const { container } = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
    const tabs = [...container.querySelectorAll('[data-tabs="v6"] nav a')].map((a) => a.textContent);
    expect(tabs[0]).toBe("Overview");
    expect(tabs).toContain("Office");
    expect(tabs).not.toContain("My assistant");
    expect(new Set(tabs).size).toBe(tabs.length);
  });
  it("ONE row on every page of My assistant: Overview | Train how it talks | Office, the open one marked (the page's own second row is gone: owner, 18 Nov)", () => {
    for (const [path, open] of [["/my-assistant", "Overview"], ["/ai-team/training", "Train how it talks"], ["/ai-team", "Office"]] as const) {
      nav.pathname = `/app/tenants/${A}${path}`;
      const { container, unmount } = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
      expect([...container.querySelectorAll('[data-tabs="v6"] nav a')].map((a) => a.textContent), path).toEqual(["Overview", "Train how it talks", "Office"]);
      expect(container.querySelector('[data-tabs="v6"] nav a[aria-current="page"]')?.textContent, path).toBe(open);
      unmount();
    }
  });
});

describe("Settings without the Settings | Team row (SETTINGS_OPEN)", () => {
  it("draws no tab row on Settings or Team when the frame says so; the other rows keep theirs", () => {
    nav.pathname = `/app/tenants/${A}/settings`;
    const off = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true }} />);
    expect(off.container.querySelector('[data-tabs="v6"]')).not.toBeNull();
    off.unmount();
    const on = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true, settingsOpen: true }} />);
    expect(on.container.querySelector('[data-tabs="v6"]')).toBeNull();
    on.unmount();
    nav.pathname = `/app/tenants/${A}/team`;
    const team = render(<GroupTabs memberships={only("owner")} frame={{ ...NO_FRAME_DATA, ds: true, settingsOpen: true }} />);
    expect(team.container.querySelector('[data-tabs="v6"]')).toBeNull();
  });
});
