import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiContractError } from "@/lib/api/client";
import { NO_FILTER } from "@/lib/lead-desk/leads";

import { fixLeadField, getLeadProfile, listDeskLeads, markLeadSeen } from "./lead-desk";

const T = "55555555-5555-4555-8555-555555555555";
const L = "66666666-6666-4666-8666-666666666666";
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ items: [], next_cursor: null });
});

describe("the Lead Desk's list from the API", () => {
  it("asks the API to narrow the list itself (status, source, urgency, words) and to leave junk out unless the person asks for it", async () => {
    await listDeskLeads("tok", T, "cur-1", { ...NO_FILTER, status: "new", source: "indiamart", urgency: "high", q: "paver" });
    const url = new URL(`https://x${request.mock.calls[0][0]}`);
    expect(url.pathname).toBe(`/v1/tenants/${T}/leads`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "25", cursor: "cur-1", status: "new", source: "indiamart", urgency: "high", q: "paver", junk: "hide" });
    request.mockClear();
    await listDeskLeads("tok", T, null, { ...NO_FILTER, junk: true });
    expect(Object.fromEntries(new URL(`https://x${request.mock.calls[0][0]}`).searchParams)).toEqual({ limit: "25" });
  });
  it("uses the API's display_name and then reads no contact (older API: the contact read gives the name and phone)", async () => {
    const row = { id: L, contact_id: "00000000-0000-4000-8000-0000000000c1", source: "webhook", status: "new", owner_user_id: null, created_at: "2026-10-30T10:00:00Z" };
    request.mockResolvedValueOnce({ items: [{ ...row, display_name: "New enquiry" }], next_cursor: null });
    const page = await listDeskLeads("tok", T, null);
    expect(page.leads[0].name).toBe("New enquiry");
    expect(request).toHaveBeenCalledTimes(1); // no GET /contacts/{id} for it
  });
  it("marks a lead seen with one POST (a bad id is refused before any call)", async () => {
    request.mockResolvedValue(null);
    await markLeadSeen("tok", T, L);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/leads/${L}/seen`, "tok", { method: "POST", body: "{}" });
    await expect(markLeadSeen("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
  });
  it("reads the profile of one lead and fixes one field with one PATCH (a bad id is refused first)", async () => {
    request.mockResolvedValue({ id: L, profile: { need: "500 paver blocks", city: "Eluru", urgency: "high", confidence: { city: "low", need: "high" }, fixed_by_you: [] } });
    const p = await getLeadProfile("tok", T, L);
    expect(p?.need).toBe("500 paver blocks");
    expect(p?.guessed).toEqual(["city"]);
    request.mockResolvedValue(null);
    await fixLeadField("tok", T, L, "city", "Vijayawada");
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/leads/${L}/profile`, "tok", { method: "PATCH", body: JSON.stringify({ city: "Vijayawada" }) });
    await expect(fixLeadField("tok", T, "../x", "city", "x")).rejects.toBeInstanceOf(ApiContractError);
  });
});
