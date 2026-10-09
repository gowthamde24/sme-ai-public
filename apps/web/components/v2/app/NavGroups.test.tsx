import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavGroups } from "./NavGroups";
import { visibleGroups } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
const show = (activeItemId: string | null, activeGroupId: string | null, pathname = `/app/tenants/${T}/orders`, role: "owner" | "sales" | "viewer" = "owner") =>
  render(<NavGroups groups={visibleGroups(role)} tenantId={T} activeItemId={activeItemId} activeGroupId={activeGroupId} pathname={pathname} />);
const group = (name: string) => screen.getByText(name).closest("details") as HTMLDetailsElement;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NavGroups", () => {
  it("starts the groups that close closed, shows the others open, and marks the current page", () => {
    show("orders", "leads");
    expect(group("Catalogue and prices")).not.toHaveAttribute("open");
    expect(group("Privacy and safety")).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("group", { name: "Today" })).toBeInTheDocument(); // an open group is a labelled group
  });
  it("the group that holds the current page opens itself", () => {
    show("quote-policy", "catalogue", `/app/tenants/${T}/quote-policy`);
    expect(group("Catalogue and prices")).toHaveAttribute("open");
    expect(group("Privacy and safety")).not.toHaveAttribute("open");
  });
  it("remembers what the person opened, and a new page keeps it", async () => {
    const { rerender } = show("orders", "leads");
    fireEvent.click(screen.getByText("Catalogue and prices"));
    expect(group("Catalogue and prices")).toHaveAttribute("open");
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("sme_nav_open") ?? "{}")).toEqual({ catalogue: true })); // the browser says "toggle" a moment later
    rerender(<NavGroups groups={visibleGroups("owner")} tenantId={T} activeItemId="review" activeGroupId="leads" pathname={`/app/tenants/${T}/review`} />);
    expect(group("Catalogue and prices")).toHaveAttribute("open");
    cleanup();
    show("orders", "leads"); // a later visit starts from what was stored
    expect(group("Catalogue and prices")).toHaveAttribute("open");
  });
  it("works with no storage at all (private window, blocked site data) and with a broken stored value", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    show("orders", "leads");
    fireEvent.click(screen.getByText("Privacy and safety"));
    expect(group("Privacy and safety")).toHaveAttribute("open");
    expect(within(group("Privacy and safety")).getByRole("link", { name: "Suppression keys" })).toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.setItem("sme_nav_open", "[1,2");
    show("orders", "leads");
    expect(group("Catalogue and prices")).not.toHaveAttribute("open");
  });
  it("a role with one item in a group gets a plain link, not a group", () => {
    show("review", "leads", `/app/tenants/${T}/review`, "viewer");
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByText("Catalogue and prices")).toBeNull();
    expect(document.querySelectorAll("details")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Security (your account)" })).toHaveAttribute("href", "/app/security");
  });
});
