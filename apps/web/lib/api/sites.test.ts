import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getSite, listSites, parseSite, parseSiteList, putSite } from "./sites";
import { COMPANY, SITE, SITE_JSON, SITE_LIST_JSON, SITE_PUT_JSON } from "./sites-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
beforeEach(() => vi.clearAllMocks());

describe("a site as the API sends it", () => {
  it("reads the place, the pin and what a truck needs to know", () => {
    expect(parseSite(SITE_JSON)).toMatchObject({ id: SITE, name: "Kukatpally villa (synthetic)", pin: "500072", map_lat: 17.4948, map_lng: 78.3996, distance_km: 18, lane_width_ft: 12, night_delivery: false, unloading_help: true });
  });
  it("a site with nothing but a name is valid", () => {
    expect(parseSite({ ...SITE_JSON, address_line: null, city: null, pin: null, map_lat: null, map_lng: null, distance_km: null, lane_width_ft: null, access_notes: null, site_contact_id: null })).toMatchObject({ map_lat: null, site_contact_id: null });
  });
  it.each([["map_lat", 91], ["map_lng", -181], ["distance_km", -1], ["name", ""], ["company_id", "x"], ["active", 1], ["night_delivery", "no"], ["site_contact_id", "x"], ["access_notes", 5]])("a site with %s = %j is a contract error", (key, value) => {
    expect(() => parseSite({ ...SITE_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("lists", () => {
    expect(parseSiteList(SITE_LIST_JSON).items.map((s) => s.active)).toEqual([true, false]);
    expect(() => parseSiteList({ items: {}, next_cursor: null })).toThrow(ApiContractError);
  });
});

describe("the calls", () => {
  it("lists a customer's sites with the inactive ones on request", async () => {
    apiRequest.mockResolvedValue(SITE_LIST_JSON);
    await listSites("tok", T, { companyId: COMPANY, includeInactive: true, after: "c", limit: 20 });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/sites?limit=20&company_id=${COMPANY}&include_inactive=true&after=c`, "tok");
    await expect(listSites("tok", T, { companyId: "bad" })).rejects.toThrow(ApiContractError);
  });
  it("reads and saves a site; the same id is a retry", async () => {
    apiRequest.mockResolvedValueOnce(SITE_JSON).mockResolvedValueOnce(SITE_PUT_JSON);
    await getSite("tok", T, SITE);
    const out = await putSite("tok", T, SITE, { company_id: COMPANY, name: "Kukatpally villa (synthetic)", night_delivery: false });
    expect(out.created).toBe(false);
    expect(apiRequest.mock.calls[1][0]).toBe(`/v1/tenants/${T}/sites/${SITE}`);
    expect(apiRequest.mock.calls[1][2].method).toBe("PUT");
    await expect(getSite("tok", T, "x")).rejects.toThrow(ApiContractError);
  });
});
