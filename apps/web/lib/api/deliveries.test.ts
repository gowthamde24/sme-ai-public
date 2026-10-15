import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
const apiUploadRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiUploadRequest: (...a: unknown[]) => apiUploadRequest(...a) }));

import { getChallan, getTrip, listOrderTrips, listTrips, markDelivered, notifySite, parseChallan, parseTrip, parseTripDetail, parseTripList, planTrip, setTripStatus, updateTrip } from "./deliveries";
import { CHALLAN_JSON, NOTIFY_JSON, ORDER, SITE, TRIP, TRIP_DELIVERED_JSON, TRIP_DETAIL_JSON, TRIP_JSON, TRIP_LIST_JSON, TRIP_PROBLEM_JSON } from "./deliveries-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
const base = `/v1/tenants/${T}`;
beforeEach(() => vi.clearAllMocks());

describe("a trip as the API sends it", () => {
  it("reads the plan, the load and the proof", () => {
    expect(parseTrip(TRIP_JSON)).toMatchObject({ id: TRIP, order_no: 7, trip_no: 1, challan_no: 41, status: "planned", vehicle_no: "TS 09 UA 1234", lines: [{ quantity: 2500, unit: "piece" }], proof: null });
    expect(parseTrip(TRIP_DELIVERED_JSON).proof).toMatchObject({ received_by: "Ravi (synthetic)", photo_url: expect.stringMatching(/^https:/) });
    expect(parseTrip(TRIP_PROBLEM_JSON)).toMatchObject({ status: "problem", problem_code: "site_closed" });
  });
  it.each([["status", "teleported"], ["problem_code", "boredom"], ["planned_date", "20/10/2026"], ["trip_no", 0], ["lines", {}], ["id", "x"], ["driver_name", 5]])("a trip with %s = %j is a contract error", (key, value) => {
    expect(() => parseTrip({ ...TRIP_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a proof photo link must be http or https", () => {
    expect(() => parseTrip({ ...TRIP_DELIVERED_JSON, proof: { ...(TRIP_DELIVERED_JSON.proof as unknown as object), photo_url: "javascript:alert(1)" } })).toThrow(ApiContractError);
  });
  it("reads a list, the detail with its events and the delivery note", () => {
    expect(parseTripList(TRIP_LIST_JSON).items).toHaveLength(2);
    expect(parseTripDetail(TRIP_DETAIL_JSON).events.map((e) => e.to_status)).toEqual(["planned", "loaded", "on_the_way", "delivered"]);
    const c = parseChallan(CHALLAN_JSON);
    expect(c).toMatchObject({ challan_no: 41, site: { pin: "500072" }, site_contact: { name: "Ravi (synthetic)" }, received_by: null });
    expect(JSON.stringify(c)).not.toMatch(/amount|price|tax|gst/i);
  });
});

describe("the calls", () => {
  it("plans a trip with the caller's id and the load", async () => {
    apiRequest.mockResolvedValue(TRIP_JSON);
    await planTrip("tok", T, ORDER, { tripId: TRIP, plannedDate: "2026-10-20", vehicleNo: "TS 09 UA 1234", driverName: "Suresh", driverPhone: "+00 90000 20001", siteId: SITE, siteContactId: null, lines: [{ line_no: 1, quantity: 2500 }] });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/orders/${ORDER}/trips`);
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toMatchObject({ trip_id: TRIP, planned_date: "2026-10-20", site_id: SITE, lines: [{ line_no: 1, quantity: 2500 }] });
    await expect(planTrip("tok", T, ORDER, { tripId: TRIP, plannedDate: "tomorrow", vehicleNo: null, driverName: null, driverPhone: null, siteId: null, siteContactId: null, lines: [] })).rejects.toThrow(ApiContractError);
  });
  it("lists the trips of a day, an order, reads one and changes one", async () => {
    apiRequest.mockResolvedValue(TRIP_LIST_JSON);
    await listTrips("tok", T, { date: "2026-10-20", status: "planned", limit: 10 });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/trips?limit=10&date=2026-10-20&status=planned`, "tok");
    await expect(listTrips("tok", T, { date: "20-10" })).rejects.toThrow(ApiContractError);
    await listOrderTrips("tok", T, ORDER);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/orders/${ORDER}/trips`, "tok");
    apiRequest.mockResolvedValueOnce(TRIP_DETAIL_JSON);
    await getTrip("tok", T, TRIP);
    apiRequest.mockResolvedValueOnce(TRIP_JSON);
    await updateTrip("tok", T, TRIP, { plannedDate: "2026-10-21", vehicleNo: null, driverName: null, driverPhone: null, siteId: null, siteContactId: null, lines: [{ line_no: 1, quantity: 100 }] });
    expect(apiRequest.mock.calls.at(-1)![2].method).toBe("PATCH");
  });
  it("sets a status; a problem carries its reason", async () => {
    apiRequest.mockResolvedValue(TRIP_PROBLEM_JSON);
    await setTripStatus("tok", T, TRIP, "problem", "site_closed");
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ status: "problem", problem_code: "site_closed" });
    await setTripStatus("tok", T, TRIP, "loaded");
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toEqual({ status: "loaded" });
  });
  it("sends the proof as the raw photo with the receiver's name in the address", async () => {
    apiUploadRequest.mockResolvedValue(TRIP_DELIVERED_JSON);
    await markDelivered("tok", T, TRIP, " Ravi Kumar ", "77777777-7777-4777-8777-777777777777", new Blob(["x"]), "image/jpeg");
    expect(apiUploadRequest.mock.calls[0][0]).toBe(`${base}/trips/${TRIP}/delivered?received_by=Ravi%20Kumar&photo_id=77777777-7777-4777-8777-777777777777`);
    await expect(markDelivered("tok", T, TRIP, "", "77777777-7777-4777-8777-777777777777", new Blob(["x"]), "image/jpeg")).rejects.toThrow(ApiContractError);
    await expect(markDelivered("tok", T, TRIP, "x", "77777777-7777-4777-8777-777777777777", new Blob(["x"]), "application/pdf")).rejects.toThrow(ApiContractError);
  });
  it("reads the delivery note and tells the site", async () => {
    apiRequest.mockResolvedValueOnce(CHALLAN_JSON).mockResolvedValueOnce(NOTIFY_JSON);
    await getChallan("tok", T, TRIP);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/trips/${TRIP}/challan`);
    const out = await notifySite("tok", T, TRIP, { messageId: "77777777-7777-4777-8777-777777777777", kind: "left", eta: "3 pm" });
    expect(out.status).toBe("queued");
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toEqual({ message_id: "77777777-7777-4777-8777-777777777777", kind: "left", eta: "3 pm", language: "en" });
  });
});
