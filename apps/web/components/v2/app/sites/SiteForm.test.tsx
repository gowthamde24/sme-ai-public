import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseSite } from "@/lib/api/sites";
import { COMPANY, CONTACT, SITE, SITE_JSON } from "@/lib/api/sites-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { SiteForm } from "./SiteForm";
import type { SiteActions } from "./sites-types";

const CUSTOMER = { id: COMPANY, name: "Sri Rama Builders", city: "Hyderabad" };
function actions(over: Partial<SiteActions> = {}) {
  return { save: vi.fn(async () => ({ ok: true as const, site: parseSite(SITE_JSON) })), search: vi.fn(async () => [CUSTOMER]), ...over } as SiteActions & { save: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> };
}
function show(a = actions(), over: Partial<React.ComponentProps<typeof SiteForm>> = {}) {
  const go = vi.fn();
  render(<SiteForm base={BASE} siteId={SITE} site={null} company={CUSTOMER} contactLabel={null} words={WORDS} actions={a} go={go} {...over} />);
  return { a, go };
}
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the site" })));
beforeEach(() => vi.restoreAllMocks());

describe("adding a site", () => {
  it("sends the whole site with the page's id and goes back to the list", async () => {
    const { a, go } = show();
    fireEvent.change(screen.getByLabelText("Name of the site"), { target: { value: "Kukatpally villa" } });
    fireEvent.change(screen.getByLabelText("City or town"), { target: { value: "Hyderabad" } });
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "500072" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "17.4948" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "78.3996" } });
    fireEvent.change(screen.getByLabelText(/Distance from your yard/), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "They help to unload" }));
    fireEvent.change(screen.getByLabelText("Notes for the driver"), { target: { value: "Gate on the left" } });
    await save();
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(a.save.mock.calls[0][0]).toMatchObject({ siteId: SITE, companyId: COMPANY, name: "Kukatpally villa", city: "Hyderabad", pin: "500072", lat: "17.4948", lng: "78.3996", distanceKm: "18", unloadingHelp: true, nightDelivery: false, accessNotes: "Gate on the left", contact: "none" });
    expect(go).toHaveBeenCalledWith(`${BASE}/sites?saved=1`);
  });
  it("needs a name, and a customer", async () => {
    const { a } = show(actions(), { company: null });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the customer first.");
    expect(a.save).not.toHaveBeenCalled();
  });
  it("finds the customer by name, then keeps the choice", async () => {
    const { a } = show(actions(), { company: null });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "Sri" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Search" })));
    expect(a.search).toHaveBeenCalledWith("Sri");
    fireEvent.click(screen.getByRole("button", { name: /Sri Rama Builders/ }));
    expect(screen.getByText("Sri Rama Builders")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name of the site"), { target: { value: "Yard" } });
    await save();
    expect(a.save.mock.calls[0][0].companyId).toBe(COMPANY);
  });
  it("a new site contact needs a name and a number", async () => {
    const { a } = show();
    fireEvent.change(screen.getByLabelText("Name of the site"), { target: { value: "Yard" } });
    fireEvent.click(screen.getByRole("radio", { name: /Someone else/ }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("name and the phone number of the person who receives");
    expect(a.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+91 90000 20002" } });
    await save();
    expect(a.save.mock.calls[0][0]).toMatchObject({ contact: "new", contactName: "Ravi", contactPhone: "+91 90000 20002" });
  });
  it("uses the phone's location only when asked, and says in words when it cannot", async () => {
    show();
    const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 17.123456789, longitude: 78.5 } }));
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Use my location" })));
    expect(screen.getByLabelText("Latitude")).toHaveValue("17.123457");
    expect(screen.getByLabelText("Longitude")).toHaveValue("78.500000");
    expect(screen.getByRole("link", { name: "Open the map pin" })).toHaveAttribute("href", "https://www.google.com/maps?q=17.123457,78.500000");
  });
  it("shows the server's sentence and the Security link for the second factor", async () => {
    show(actions({ save: vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app.", mfa: true })) as never }));
    fireEvent.change(screen.getByLabelText("Name of the site"), { target: { value: "Yard" } });
    await save();
    expect(screen.getByRole("link", { name: /Security/ })).toBeInTheDocument();
  });
});

describe("changing a site", () => {
  it("keeps the customer fixed, offers to keep the site contact and to put the site away", async () => {
    const { a } = show(actions(), { site: parseSite(SITE_JSON), contactLabel: "Ravi (synthetic)" });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.getByText("Now: Ravi (synthetic)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Keep this person" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "This site is in use" }));
    await save();
    expect(a.save.mock.calls[0][0]).toMatchObject({ contact: "keep", active: false, companyId: COMPANY });
    expect(CONTACT).toBeTruthy();
  });
});
