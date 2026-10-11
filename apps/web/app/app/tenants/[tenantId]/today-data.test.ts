import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseCallRequestPage, parseOutboxPage } from "@/lib/api/outbox";
import { CALL_JSON, PRICE_JSON, page } from "@/lib/api/outbox-fixtures";
import { agentsStatus, todayFor } from "@/test/screens/today-fixtures";

const getToday = vi.fn();
const getAgentsStatus = vi.fn();
const listOutboxApprovals = vi.fn();
const listCallRequests = vi.fn();
const listOutboxMessages = vi.fn();
const fetchQuotes = vi.fn();
vi.mock("@/lib/api/today", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/today")>()), getToday: (...a: unknown[]) => getToday(...a), getAgentsStatus: (...a: unknown[]) => getAgentsStatus(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/outbox")>()),
  listOutboxApprovals: (...a: unknown[]) => listOutboxApprovals(...a),
  listCallRequests: (...a: unknown[]) => listCallRequests(...a),
  listOutboxMessages: (...a: unknown[]) => listOutboxMessages(...a),
}));
vi.mock("@/lib/api/quotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/quotes")>()), fetchQuotes: (...a: unknown[]) => fetchQuotes(...a), fetchQuote: async () => { throw new ApiRequestError(500, "api_error", "x"); } }));

import { readToday } from "./today-data";

const T = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  getToday.mockResolvedValue(todayFor("owner"));
  getAgentsStatus.mockResolvedValue(agentsStatus());
  listOutboxApprovals.mockResolvedValue(parseOutboxPage(page([PRICE_JSON])));
  listCallRequests.mockResolvedValue(parseCallRequestPage(page([CALL_JSON])));
  listOutboxMessages.mockResolvedValue(parseOutboxPage(page([])));
  fetchQuotes.mockResolvedValue([]);
});

describe("readToday: the cards", () => {
  it("makes one card per item in the API's order, with the words of a message and the reason of a call joined by id", async () => {
    const data = await readToday("tok", T, "owner");
    expect(data.needs?.map((c) => c.type)).toEqual(["outbox", "call", "item", "item", "item"]);
    const [message, request] = data.needs!;
    expect(message).toMatchObject({ type: "outbox", id: PRICE_JSON.id, customer: "Synthetic Buyer", message: { language: "te", flags: ["money"], category: "reply_to_inbound" } });
    expect(request).toMatchObject({ type: "call", request: { reason: CALL_JSON.reason } });
    expect(data.cards.waiting).toBe(5);
    expect(data.visits).toBeNull(); // store visits are not in the API yet
  });
  it("a card whose words are not in the queue still appears, without them", async () => {
    listOutboxApprovals.mockResolvedValue(parseOutboxPage(page([])));
    listCallRequests.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    expect(data.needs?.[0]).toMatchObject({ type: "outbox", message: null });
    expect(data.needs?.[1]).toMatchObject({ type: "call", request: null });
  });
  it("an empty customer name (a lead with no company) becomes null", async () => {
    getToday.mockResolvedValue({ ...todayFor("owner"), needs_you: [{ ...todayFor("owner").needs_you[0], customer: "" }] });
    expect((await readToday("tok", T, "owner")).needs?.[0]).toMatchObject({ customer: null });
  });
  it("Today unreadable: needs is null, the team is still read", async () => {
    getToday.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    expect(data.needs).toBeNull();
    expect(data.team).toHaveLength(7);
    expect(listOutboxApprovals).not.toHaveBeenCalled();
  });
  it("a rejected session is thrown so the page can send the person to sign in, from any of the reads", async () => {
    getToday.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner")).rejects.toThrow(ApiAuthError);
    getToday.mockResolvedValue(todayFor("owner"));
    listOutboxApprovals.mockRejectedValue(new ApiAuthError("x"));
    await expect(readToday("tok", T, "owner")).rejects.toThrow(ApiAuthError);
  });
});

describe("readToday: the outbox log", () => {
  it("starts reading it at once as one promise that never rejects", async () => {
    listOutboxMessages.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    const data = await readToday("tok", T, "owner");
    await expect(data.digest).resolves.toEqual({ state: "error" });
  });
  it("is not asked for a Viewer", async () => {
    getToday.mockResolvedValue(todayFor("viewer"));
    const data = await readToday("tok", T, "viewer");
    expect(data.digest).toBeNull();
    expect(listOutboxMessages).not.toHaveBeenCalled();
  });
});
