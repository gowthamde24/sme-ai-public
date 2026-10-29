import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

import { ApiContractError } from "@/lib/api/client";
import { NO_FILTER } from "@/lib/lead-desk/leads";

import { listDeskLeads, markLeadSeen } from "./lead-desk";

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
  it("marks a lead seen with one POST (a bad id is refused before any call)", async () => {
    request.mockResolvedValue(null);
    await markLeadSeen("tok", T, L);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/leads/${L}/seen`, "tok", { method: "POST", body: "{}" });
    await expect(markLeadSeen("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
  });
});
