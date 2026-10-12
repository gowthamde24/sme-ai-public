import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { CONTACT_PAGES, readConsentList, summarise } from "./consent-list";

const T = "22222222-2222-4222-8222-222222222222";
const row = (n: number, over: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, full_name: `Person ${n}`, email: null, phone: null, job_title: null, email_consent: "unknown", whatsapp_consent: "unknown", phone_consent: "unknown", suppression_reason: null, created_via: "manual", ...over });
beforeEach(() => vi.clearAllMocks());

describe("the consent and opt-out list", () => {
  it("counts the consent of every channel and lists those who asked us to stop, by name", async () => {
    apiRequest.mockResolvedValue({ items: [row(1, { whatsapp_consent: "granted" }), row(2, { suppression_reason: "opted_out" }), row(3, { email_consent: "withdrawn" }), row(4)], next_cursor: null });
    const l = await readConsentList("tok", T);
    expect(l.checked).toBe(4);
    expect(l.truncated).toBe(false);
    expect(l.counts.whatsapp).toEqual({ unknown: 3, granted: 1, withdrawn: 0 });
    expect(l.counts.email).toEqual({ unknown: 3, granted: 0, withdrawn: 1 });
    expect(l.stopped.map((s) => s.name)).toEqual(["Person 2", "Person 3"]);
    expect(l.stopped[0].reason).toBe("opted_out");
    expect(l.stopped[1].channels.email).toBe("withdrawn");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/contacts?limit=100`, "tok");
  });
  it("follows the cursor, and says it looked at the first pages only when there are more", async () => {
    apiRequest.mockImplementation(async () => ({ items: [row(1)], next_cursor: "more" }));
    const l = await readConsentList("tok", T);
    expect(apiRequest).toHaveBeenCalledTimes(CONTACT_PAGES);
    expect(l.truncated).toBe(true);
    expect(apiRequest.mock.calls[1][0]).toContain("cursor=more");
  });
  it("an empty list is an empty list", () => {
    const l = summarise([], false);
    expect(l).toEqual({ checked: 0, truncated: false, stopped: [], counts: { whatsapp: { unknown: 0, granted: 0, withdrawn: 0 }, phone: { unknown: 0, granted: 0, withdrawn: 0 }, email: { unknown: 0, granted: 0, withdrawn: 0 } } });
  });
  it("refuses a workspace id that is not one", async () => {
    await expect(readConsentList("tok", "x")).rejects.toThrow();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
