import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { activateWhatsapp, connectionState, disableWhatsapp, getThread, getWhatsappAccount, listConversations, markConversationRead, parseAccount, parseConversationPage, parseThread, putWhatsappAccount } from "./whatsapp";

const T = "22222222-2222-4222-8222-222222222222";
const L = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = { configured: true, status: "active", waba_id: "123456789", phone_number_id: "987654321", display_phone: "+91 98765 43210", coexistence: false, token_ref: "SHOP_TOKEN", token_available: true, updated_at: "2026-10-12T10:00:00Z" };
beforeEach(() => vi.clearAllMocks());

describe("the number's four states", () => {
  it("no account is 'not connected'", () => {
    expect(connectionState(parseAccount({ configured: false, status: "none" }))).toEqual({ state: "not_connected", why: null });
  });
  it("saved but not switched on is 'connecting'; active with its secret is 'connected'", () => {
    expect(connectionState(parseAccount({ ...ACCOUNT, status: "pending" })).state).toBe("connecting");
    expect(connectionState(parseAccount(ACCOUNT)).state).toBe("connected");
  });
  it("switched off, or without its secret on the server, 'needs attention', and says which", () => {
    expect(connectionState(parseAccount({ ...ACCOUNT, status: "disabled" }))).toEqual({ state: "needs_attention", why: "disabled" });
    expect(connectionState(parseAccount({ ...ACCOUNT, token_available: false }))).toEqual({ state: "needs_attention", why: "token_missing" });
    expect(connectionState(parseAccount({ ...ACCOUNT, status: "pending", token_available: false }))).toEqual({ state: "needs_attention", why: "token_missing" });
  });
  it("a status we do not know, or a token_ref with spaces, is a contract error", () => {
    expect(() => parseAccount({ ...ACCOUNT, status: "broken" })).toThrow(ApiContractError);
    expect(() => parseAccount({ ...ACCOUNT, token_ref: "a b" })).toThrow(ApiContractError);
  });
});

describe("the account calls", () => {
  it("reads it; saves it with the typed ids and the name of the secret; switches it on and off", async () => {
    apiRequest.mockResolvedValue(ACCOUNT);
    expect((await getWhatsappAccount("tok", T)).configured).toBe(true);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/whatsapp/account`, "tok");
    await putWhatsappAccount("tok", T, { wabaId: " 123456789 ", phoneNumberId: "987654321", displayPhone: "", coexistence: true, tokenRef: "SHOP_TOKEN" });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/whatsapp/account`, "tok", { method: "PUT", body: JSON.stringify({ waba_id: "123456789", phone_number_id: "987654321", coexistence: true, token_ref: "SHOP_TOKEN" }) });
    apiRequest.mockClear();
    apiRequest.mockResolvedValueOnce({ id: "x", status: "active" }).mockResolvedValueOnce(ACCOUNT);
    expect((await activateWhatsapp("tok", T)).configured).toBe(true);
    expect(apiRequest).toHaveBeenNthCalledWith(1, `/v1/tenants/${T}/whatsapp/account/activate`, "tok", { method: "POST" });
    expect(apiRequest).toHaveBeenNthCalledWith(2, `/v1/tenants/${T}/whatsapp/account`, "tok"); // read again: what is true, not what was asked
    apiRequest.mockClear();
    apiRequest.mockResolvedValueOnce({ id: "x", status: "disabled" }).mockResolvedValueOnce({ ...ACCOUNT, status: "disabled" });
    expect(connectionState(await disableWhatsapp("tok", T)).state).toBe("needs_attention");
    expect(apiRequest).toHaveBeenNthCalledWith(1, `/v1/tenants/${T}/whatsapp/account/disable`, "tok", { method: "POST" });
  });
});

describe("the inbox", () => {
  const CONV = { lead_id: L, contact_id: "x", name: "Ravi Kumar", company: "WhatsApp customer 3fa9c1", phone: "+919876543210", last_at: "2026-10-12T10:00:00Z", last_direction: "in", preview: "Do you have red sarees?", last_inbound_at: "2026-10-12T10:00:00Z", window_open: true, window_expires_at: "2026-10-13T10:00:00Z", unread: true, stopped: false };
  it("reads the threads and drops the phone number (the screen has no use for it)", async () => {
    apiRequest.mockResolvedValue({ conversations: [CONV], next_before: null });
    const p = await listConversations("tok", T, { limit: 20, before: "2026-10-12T09:00:00Z" });
    expect(p.conversations[0]).toMatchObject({ lead_id: L, name: "Ravi Kumar", unread: true, window_open: true });
    expect(JSON.stringify(p)).not.toContain("9876543210");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/conversations?limit=20&before=2026-10-12T09%3A00%3A00Z`, "tok");
  });
  it("a conversation with a direction we do not know is a contract error", () => {
    expect(() => parseConversationPage({ conversations: [{ ...CONV, last_direction: "sideways" }], next_before: null })).toThrow(ApiContractError);
  });
  const THREAD = {
    lead_id: L, contact_id: "x", name: "Ravi Kumar", phone: "+919876543210", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: "2026-10-13T10:00:00Z", next_before: null,
    items: [
      { direction: "out", id: "44444444-4444-4444-8444-444444444444", at: "2026-10-12T10:05:00Z", text: "Yes, we have red sarees.", status: "needs_approval", reason: "money", source: "owner", delivery: null, delivered_at: null, read_at: null, delivery_error: null, failure_code: null, photos: 0 },
      { direction: "in", id: "55555555-5555-4555-8555-555555555555", at: "2026-10-12T10:00:00Z", text: "Do you have red sarees?" },
    ],
  };
  it("reads a thread: what we sent with its state and reason, what they sent as text", async () => {
    apiRequest.mockResolvedValue(THREAD);
    const t = await getThread("tok", T, L);
    expect(t.items[0]).toMatchObject({ direction: "out", status: "needs_approval", reason: "money", delivery: null });
    expect(t.items[1]).toMatchObject({ direction: "in", status: null, reason: null });
    expect(JSON.stringify(t)).not.toContain("9876543210");
    expect(t.whatsapp_consent).toBe("granted");
  });
  it("an outgoing message with a state we do not know is a contract error", () => {
    expect(() => parseThread({ ...THREAD, items: [{ ...THREAD.items[0], status: "teleported" }] })).toThrow(ApiContractError);
    expect(() => parseThread({ ...THREAD, items: [{ ...THREAD.items[0], delivery: "lost" }] })).toThrow(ApiContractError);
  });
  it("marks a thread read with a POST, and refuses a lead id that is not one", async () => {
    apiRequest.mockResolvedValue(null);
    await markConversationRead("tok", T, L);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/conversations/${L}/read`, "tok", { method: "POST" });
    await expect(getThread("tok", T, "nope")).rejects.toThrow(ApiContractError);
  });
});
