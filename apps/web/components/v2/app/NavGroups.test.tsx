import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NavGroups } from "./NavGroups";
import { visibleGroups } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
afterEach(cleanup);

describe("NavGroups", () => {
  it("draws each group with its small heading and its rows, and marks the current page", () => {
    render(<NavGroups groups={visibleGroups("owner")} tenantId={T} activeItemId="orders" />);
    for (const name of ["Work", "Your business", "Your team", "Connect"]) expect(screen.getByRole("group", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", `/app/tenants/${T}/orders`);
    expect(screen.getByRole("link", { name: "Leads" })).not.toHaveAttribute("aria-current");
    expect(document.querySelector("details")).toBeNull(); // nothing opens or closes: every row is one look away
  });
  it("shows the count of what is waiting on Today only when there is one, with the words for a screen reader", () => {
    const { rerender } = render(<NavGroups groups={visibleGroups("owner")} tenantId={T} activeItemId="today" waiting={5} />);
    expect(within(screen.getByRole("link", { name: /Today/ })).getByText("5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Today/ })).toHaveTextContent("Waiting for you: 5");
    rerender(<NavGroups groups={visibleGroups("owner")} tenantId={T} activeItemId="today" waiting={null} />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveTextContent(/^Today$/);
    rerender(<NavGroups groups={visibleGroups("owner")} tenantId={T} activeItemId="today" waiting={0} />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveTextContent(/^Today$/);
  });
  it("in the narrow rail the rows keep their words for a screen reader and a tooltip", () => {
    render(<NavGroups groups={visibleGroups("sales")} tenantId={T} activeItemId="leads" collapsed />);
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("title", "Leads");
    expect(screen.queryByText("Work", { selector: "p" })).toBeNull();
  });
});
