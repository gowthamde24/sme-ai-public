import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => api(...a) }));

import { getConsentAsk, parseConsentAsk, sendConsentAsk } from "./consent-ask";

const T = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";
const ok = { lead_id: L, customer: "Kalyani Gowda", needed: true, reason: null, language: "te", text: "Hello…", how: "message", window_open: true, message_id: M };

beforeEach(() => api.mockReset());

describe("Ask for consent: the API's shapes (C1, 18 Nov)", () => {
  it("reads a sendable ask", () => {
    expect(parseConsentAsk(ok)).toMatchObject({ needed: true, how: "message", text: "Hello…", messageId: M, windowOpen: true, reason: null });
  });
  it("an ask without words or an id, or a how it does not know, cannot be sent", () => {
    expect(parseConsentAsk({ ...ok, message_id: null })).toMatchObject({ how: "none", reason: "unknown" });
    expect(parseConsentAsk({ ...ok, how: "carrier_pigeon" })).toMatchObject({ how: "none" });
    expect(parseConsentAsk({ ...ok, needed: false, how: "none", reason: "stopped", text: null, message_id: null })).toMatchObject({ how: "none", reason: "stopped" });
    expect(parseConsentAsk({ ...ok, needed: false, how: "none", reason: "something_new", text: null, message_id: null }).reason).toBe("unknown");
  });
  it("previews with a GET and sends with a POST carrying only the message id", async () => {
    api.mockResolvedValueOnce(ok);
    await getConsentAsk("tok", T, L);
    expect(api).toHaveBeenLastCalledWith(`/v1/tenants/${T}/leads/${L}/consent-ask`, "tok");
    api.mockResolvedValueOnce({ message: {}, replayed: true });
    expect(await sendConsentAsk("tok", T, L, M)).toEqual({ replayed: true });
    expect(api).toHaveBeenLastCalledWith(`/v1/tenants/${T}/leads/${L}/consent-ask`, "tok", { method: "POST", body: JSON.stringify({ message_id: M }) });
  });
  it("refuses a message id that is not a uuid before asking", async () => {
    await expect(sendConsentAsk("tok", T, L, "x")).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
});
