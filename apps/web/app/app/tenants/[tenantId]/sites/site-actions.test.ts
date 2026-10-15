import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseSite } from "@/lib/api/sites";
import { SITE_JSON } from "@/lib/api/sites-fixtures";

const api = { put: vi.fn(), contact: vi.fn(), search: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/sites", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/sites")>()), putSite: (...a: unknown[]) => api.put(...a) }));
vi.mock("@/lib/api/customers", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/customers")>()), createContact: (...a: unknown[]) => api.contact(...a) }));
vi.mock("@/lib/api/companies", () => ({ searchCompanies: (...a: unknown[]) => api.search(...a) }));

import { saveSiteAction, searchCompaniesAction } from "./site-actions";

const T = "22222222-2222-4222-8222-222222222222";
const SITE = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-2222222222aa";
const input = { siteId: SITE, companyId: COMPANY, name: "Kukatpally villa", addressLine: "Plot 14", city: "Hyderabad", pin: "500072", lat: "17.4948", lng: "78.3996", distanceKm: "18", laneWidthFt: "12", nightDelivery: false, unloadingHelp: true, accessNotes: "Gate on the left", active: true, contact: "none" as const, contactName: "", contactPhone: "" };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("saving a site", () => {
  it("sends the whole site, turns empty boxes into nothing and numbers into numbers", async () => {
    api.put.mockResolvedValue({ site: parseSite(SITE_JSON), created: true });
    const r = await saveSiteAction(T, null, { ...input, addressLine: "", laneWidthFt: "" });
    expect(r).toMatchObject({ ok: true });
    expect(api.put).toHaveBeenCalledWith("tok", T, SITE, { company_id: COMPANY, name: "Kukatpally villa", address_line: null, city: "Hyderabad", pin: "500072", map_lat: 17.4948, map_lng: 78.3996, distance_km: 18, lane_width_ft: null, night_delivery: false, unloading_help: true, access_notes: "Gate on the left", site_contact_id: null, active: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/sites`);
  });
  it("makes the site contact first, as a contact of THIS customer, and names it on the site", async () => {
    api.contact.mockResolvedValue(CONTACT);
    api.put.mockResolvedValue({ site: parseSite(SITE_JSON), created: true });
    await saveSiteAction(T, null, { ...input, contact: "new", contactName: " Ravi ", contactPhone: "+91 90000 20002" });
    expect(api.contact).toHaveBeenCalledWith("tok", T, expect.objectContaining({ companyId: COMPANY, fullName: "Ravi", phone: "+91 90000 20002", email: null }));
    expect(api.put.mock.calls[0][3].site_contact_id).toBe(CONTACT);
  });
  it("keeping the contact keeps the one the site has", async () => {
    api.put.mockResolvedValue({ site: parseSite(SITE_JSON), created: false });
    await saveSiteAction(T, CONTACT, { ...input, contact: "keep" });
    expect(api.contact).not.toHaveBeenCalled();
    expect(api.put.mock.calls[0][3].site_contact_id).toBe(CONTACT);
  });
  it.each([
    ["a latitude without a longitude", { lng: "" }], ["a latitude out of range", { lat: "91" }], ["a PIN code of five digits", { pin: "50007" }], ["a negative distance", { distanceKm: "-1" }], ["a fractional distance", { distanceKm: "1.5" }],
    ["no name", { name: "  " }], ["a notes box that is too long", { accessNotes: "n".repeat(1001) }], ["a bad customer id", { companyId: "x" }], ["a bad site id", { siteId: "x" }], ["a number that is not a number", { lat: "north", lng: "east" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveSiteAction(T, null, { ...input, ...over })).toEqual({ ok: false, error: "Something in the form is not right (the PIN code is six digits; the map pin needs both numbers). Nothing was saved." });
    expect(api.put).not.toHaveBeenCalled();
    expect(api.contact).not.toHaveBeenCalled();
  });
  it("a new contact without a name or number makes nothing", async () => {
    expect(await saveSiteAction(T, null, { ...input, contact: "new", contactName: "Ravi", contactPhone: "" })).toMatchObject({ ok: false, error: expect.stringContaining("name and the phone number") });
    expect(api.contact).not.toHaveBeenCalled();
  });
  it.each([[422, "validation_error", "no phone numbers"], [403, "forbidden", "role does not allow"], [403, "mfa_required", "authenticator"], [503, "sites_unavailable", "not available"]])("%i %s is said in our words", async (s, c, text) => {
    api.put.mockRejectedValue(refusal(s, c));
    const r = await saveSiteAction(T, null, input);
    expect((r as { error: string }).error.toLowerCase()).toContain(text);
  });
  it("a rejected session goes to sign-in", async () => {
    api.put.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveSiteAction(T, null, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("finding a customer", () => {
  it("returns the names and the cities only, and nothing on a bad query", async () => {
    api.search.mockResolvedValue([{ id: COMPANY, name: "Sri Rama Builders", city: "Hyderabad" }]);
    expect(await searchCompaniesAction(T, "Sri")).toEqual([{ id: COMPANY, name: "Sri Rama Builders", city: "Hyderabad" }]);
    expect(await searchCompaniesAction("x", "Sri")).toEqual([]);
    api.search.mockRejectedValue(refusal(503, "x"));
    expect(await searchCompaniesAction(T, "Sri")).toEqual([]);
  });
});
