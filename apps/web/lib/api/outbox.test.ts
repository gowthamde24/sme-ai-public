import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import {
  approveCallRequest,
  approveOutboxMessage,
  editOutboxMessage,
  listCallRequests,
  listOutboxApprovals,
  listOutboxMessages,
  parseCallRequest,
  parseOutboxMessage,
  parseOutboxPage,
  rejectCallRequest,
  rejectOutboxMessage,
} from "./outbox";
import { BLOCKED_JSON, CALL_ID, CALL_JSON, MSG_PRICE, PRICE_JSON, QUIET_JSON, SENT_JSON, page } from "./outbox-fixtures";

const TENANT = "22222222-2222-4222-8222-222222222222";
const base = `/v1/tenants/${TENANT}`;

beforeEach(() => vi.clearAllMocks());

describe("parsing the outbox as the API sends it", () => {
  it("reads every state a message can be in, with the exact words and the closed reason", () => {
    const m = parseOutboxMessage(PRICE_JSON);
    expect(m).toMatchObject({ id: MSG_PRICE, status: "needs_approval", reason: "money", language: "te", flags: ["money"], category: "reply_to_inbound", source: "assistant" });
    expect(m.text).toContain("ధర 500");
    for (const j of [SENT_JSON, BLOCKED_JSON, QUIET_JSON]) expect(() => parseOutboxMessage(j)).not.toThrow();
    expect(parseOutboxMessage(QUIET_JSON).scheduled_for).toBe("2026-10-11T03:30:00Z");
  });
  it("never has a phone number to read: a message carries none", () => {
    expect(Object.keys(parseOutboxMessage(PRICE_JSON)).join(" ")).not.toMatch(/phone|number|contact/i);
  });
  it.each([
    ["channel", "sms"], ["status", "approved"], ["reason", "because"], ["language", "fr"], ["category", "ads"], ["source", "robot"], ["flags", ["money", "luck"]], ["flags", "money"],
    ["id", "x"], ["lead_id", 5], ["text", ""], ["text", 5], ["reason_text", ""], ["created_at", "yesterday"], ["sent_at", "soon"], ["failure_code", "oops"], ["model_flagged", "no"], ["customer", 5],
  ])("a message with %s = %j is a contract error", (key, value) => {
    expect(() => parseOutboxMessage({ ...PRICE_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("a customer may be null (a lead with no company)", () => {
    expect(parseOutboxMessage({ ...PRICE_JSON, customer: null, city: null })).toMatchObject({ customer: null, city: null });
  });
  it("a page is a list and a cursor, at most a hundred long", () => {
    expect(parseOutboxPage(page([PRICE_JSON, SENT_JSON], "abc"))).toMatchObject({ next_cursor: "abc" });
    expect(parseOutboxPage(page([])).items).toEqual([]);
    expect(() => parseOutboxPage(page(Array(101).fill(PRICE_JSON)))).toThrow(ApiContractError);
    expect(() => parseOutboxPage({ items: "no", next_cursor: null })).toThrow(ApiContractError);
    expect(() => parseOutboxPage(page([PRICE_JSON], ""))).toThrow(ApiContractError);
  });
  it("reads a call request and refuses a state the API does not send", () => {
    expect(parseCallRequest(CALL_JSON)).toMatchObject({ id: CALL_ID, status: "requested", reason: "The customer asked for a call about a large wedding order." });
    expect(() => parseCallRequest({ ...CALL_JSON, status: "dialled" })).toThrow(ApiContractError);
    expect(() => parseCallRequest({ ...CALL_JSON, reason: "" })).toThrow(ApiContractError);
  });
});

describe("reading and deciding, with the person's token, inside the workspace", () => {
  it("lists the log newest first (a page of 30 unless asked) and the waiting queue", async () => {
    apiRequest.mockResolvedValue(page([SENT_JSON]));
    await listOutboxMessages("tok", TENANT);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/messages?limit=30`, "tok");
    await listOutboxMessages("tok", TENANT, { limit: 100, after: "cur sor", status: "sent" });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/messages?limit=100&after=cur+sor&status=sent`, "tok");
    await listOutboxApprovals("tok", TENANT, { limit: 100 });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/approvals?limit=100`, "tok");
  });
  it("edit sends only the words; approve and reject send nothing but the decision", async () => {
    apiRequest.mockResolvedValue(PRICE_JSON);
    await editOutboxMessage("tok", TENANT, MSG_PRICE, "new words");
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/messages/${MSG_PRICE}/edit`, "tok", { method: "POST", body: JSON.stringify({ text: "new words" }) });
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "sent", reason: "owner_approved" }, dispatched: { sent: 1, failed: 0 } });
    const done = await approveOutboxMessage("tok", TENANT, MSG_PRICE);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/messages/${MSG_PRICE}/approve`, "tok", { method: "POST" });
    expect(done.message.status).toBe("sent");
    expect(done.dispatched).toEqual({ sent: 1, failed: 0 });
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "blocked", reason: "owner_rejected" }, dispatched: null });
    expect((await rejectOutboxMessage("tok", TENANT, MSG_PRICE)).message.reason).toBe("owner_rejected");
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/outbox/messages/${MSG_PRICE}/reject`, "tok", { method: "POST" });
  });
  it("lists the calls that are asked for, and approves or declines one with an optional note", async () => {
    apiRequest.mockResolvedValue(page([CALL_JSON]));
    expect((await listCallRequests("tok", TENANT, { status: "requested", limit: 100 })).items).toHaveLength(1);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/call-requests?limit=100&status=requested`, "tok");
    apiRequest.mockResolvedValue({ ...CALL_JSON, status: "approved" });
    await approveCallRequest("tok", TENANT, CALL_ID);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/call-requests/${CALL_ID}/approve`, "tok", { method: "POST", body: "{}" });
    apiRequest.mockResolvedValue({ ...CALL_JSON, status: "rejected", decision_note: "offer_store_visit" });
    expect((await rejectCallRequest("tok", TENANT, CALL_ID, "offer_store_visit")).decision_note).toBe("offer_store_visit");
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/call-requests/${CALL_ID}/reject`, "tok", { method: "POST", body: JSON.stringify({ note: "offer_store_visit" }) });
  });
  it("refuses a malformed id before any request is made", async () => {
    await expect(approveOutboxMessage("tok", TENANT, "../x")).rejects.toThrow(ApiContractError);
    await expect(listOutboxMessages("tok", "a/b")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("an answer that does not match the contract is an error, never a guess", async () => {
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "weird" }, dispatched: null });
    await expect(approveOutboxMessage("tok", TENANT, MSG_PRICE)).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValue({ message: PRICE_JSON, dispatched: { sent: "1", failed: 0 } });
    await expect(approveOutboxMessage("tok", TENANT, MSG_PRICE)).rejects.toThrow(ApiContractError);
  });
});
