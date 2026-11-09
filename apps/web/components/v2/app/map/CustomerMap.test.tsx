import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { groupPlaces } from "@/lib/map/places";

import { CustomerMap } from "./CustomerMap";

const W = wordsFor("en", ["map."]);
const BASE = "/app/tenants/t";
afterEach(cleanup);
const grouped = groupPlaces(
  [{ id: "a", name: "Meena", profile: { city: "Guntur", area: "Brodipet" } }, { id: "b", name: "Lakshmi", profile: { city: "Guntur", area: null } }, { id: "c", name: "Anita", profile: null }],
  [{ id: "s1", name: "Lake Road site", address_line: "12 Lake Road", city: "Guntur", pin: "522001" }],
  BASE,
);

describe("Customers > Map (app v4)", () => {
  it("lists the real places, each customer a link to their page, a site with its address, and says how it is made", () => {
    render(<CustomerMap {...grouped} w={W} unread={{ customers: false, sites: false }} />);
    const guntur = within(document.querySelector('[data-place="guntur"]') as HTMLElement);
    expect(guntur.getByRole("heading", { name: /Guntur/ })).toHaveTextContent("2 customers · 1 site");
    expect(guntur.getByRole("link", { name: /Meena/ })).toHaveAttribute("href", `${BASE}/customers/a`);
    expect(guntur.getByText("12 Lake Road, Guntur 522001")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is looked up/)).toBeInTheDocument();
    expect(screen.getByText("2 customers · 1 site · 1 customer has no place yet")).toBeInTheDocument();
  });
  it("says so when nothing has a place, and when a part could not be read (never \"no customers\")", () => {
    render(<CustomerMap places={[]} customers={0} withoutPlace={0} sites={0} w={W} unread={{ customers: true, sites: false }} />);
    expect(screen.getByText(/No customer has given a place yet/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The customers could not be read just now.");
    cleanup();
    render(<CustomerMap places={[]} customers={0} withoutPlace={0} sites={0} w={W} unread={{ customers: true, sites: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The customers and the sites could not be read just now.");
  });
});
