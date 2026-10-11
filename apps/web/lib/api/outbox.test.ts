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
  rejectOutboxMessage,
  createCallRequest,
  dispatchOutbox,
  getOutboxSettings,
  parseOutboxSettings,
  putOutboxSettings,
  submitOutboxMessage,
  getOutboxMessage,
  getOutboxSummary,
  parseOutboxSummary,
  QUIET_END,
  QUIET_START,
} from "./outbox";
import { BLOCKED_JSON, CALL_ID, CALL_JSON, MSG_PRICE, PRICE_JSON, QUIET_JSON, SENT_JSON, page } from "./outbox-fixtures";

const TENANT = "22222222-2222-4222-8222-222222222222";
const base = `/v1/tenants/${TENANT}`;

beforeEach(() => vi.clearAllMocks());

describe("the photos a message carries (job AY/BC)", () => {
  const P1 = "0f8a927d-1111-4a11-8a11-000000000001";
  it("reads the thumbnails in order; a message with none (or from an API before photos) has an empty list", () => {
    expect(parseOutboxMessage(PRICE_JSON).media).toEqual([]);
    const m = parseOutboxMessage({ ...PRICE_JSON, media: [{ photo_id: P1, position: 1, thumb_url: "https://s.example/a.jpg?token=1" }, { photo_id: P1, position: 2, thumb_url: null }] });
    expect(m.media.map((x) => [x.position, x.thumb_url])).toEqual([[1, "https://s.example/a.jpg?token=1"], [2, null]]);
  });
  it("refuses more than four photos, a bad id, and a link that is not http(s)", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ photo_id: P1, position: i + 1, thumb_url: null }));
    expect(() => parseOutboxMessage({ ...PRICE_JSON, media: five })).toThrow(ApiContractError);
    expect(() => parseOutboxMessage({ ...PRICE_JSON, media: [{ photo_id: "x", position: 1, thumb_url: null }] })).toThrow(ApiContractError);
    expect(() => parseOutboxMessage({ ...PRICE_JSON, media: [{ photo_id: P1, position: 1, thumb_url: "javascript:alert(1)" }] })).toThrow(ApiContractError);
  });
});

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
  it("reads a message made by a visit template (source system, category visit)", () => {
    expect(parseOutboxMessage({ ...SENT_JSON, source: "system", category: "visit" })).toMatchObject({ source: "system", category: "visit" });
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
  it("lists the calls that are asked for and approves one", async () => {
    apiRequest.mockResolvedValue(page([CALL_JSON]));
    expect((await listCallRequests("tok", TENANT, { status: "requested", limit: 100 })).items).toHaveLength(1);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/call-requests?limit=100&status=requested`, "tok");
    apiRequest.mockResolvedValue({ ...CALL_JSON, status: "approved" });
    await approveCallRequest("tok", TENANT, CALL_ID);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/call-requests/${CALL_ID}/approve`, "tok", { method: "POST", body: "{}" });
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

describe("making a message and asking for a call", () => {
  const LEAD = "7c1f0a52-3b11-4c6e-9d0a-5e2b8f4a1c01";
  it("submits the person's words for the lead: no number, no status, no reason, source owner", async () => {
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "queued" }, replayed: false, dispatched: null });
    const out = await submitOutboxMessage("tok", TENANT, { messageId: MSG_PRICE, leadId: LEAD, text: "Hello, we are open today.", language: "en", category: "info" });
    expect(out.replayed).toBe(false);
    const [path, , init] = apiRequest.mock.calls[0];
    expect(path).toBe(`${base}/outbox/messages`);
    expect(JSON.parse(init.body)).toEqual({ message_id: MSG_PRICE, lead_id: LEAD, text: "Hello, we are open today.", language: "en", category: "info", source: "owner" });
  });
  it("sends up to four catalogue photos and the record flag only when they are used (a plain text message is the request it always was)", async () => {
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "queued" }, replayed: false, dispatched: null });
    const P1 = "0f8a927d-1111-4a11-8a11-000000000001";
    const P2 = "0f8a927d-1111-4a11-8a11-000000000002";
    await submitOutboxMessage("tok", TENANT, { messageId: MSG_PRICE, leadId: LEAD, text: "Here is a saree.", language: "en", category: "info", photoIds: [P1, P2], keepRecord: true });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ message_id: MSG_PRICE, lead_id: LEAD, text: "Here is a saree.", language: "en", category: "info", source: "owner", photo_ids: [P1, P2], keep_record: true });
    apiRequest.mockClear();
    await submitOutboxMessage("tok", TENANT, { messageId: MSG_PRICE, leadId: LEAD, text: "Hello.", language: "en", category: "info", photoIds: [], keepRecord: false });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).not.toHaveProperty("photo_ids");
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).not.toHaveProperty("keep_record");
    await expect(submitOutboxMessage("tok", TENANT, { messageId: MSG_PRICE, leadId: LEAD, text: "x", language: "en", category: "info", photoIds: ["../x"] })).rejects.toThrow(ApiContractError);
  });
  it("asks for a call with a reason and the words to say", async () => {
    apiRequest.mockResolvedValue({ request: CALL_JSON, replayed: true });
    const out = await createCallRequest("tok", TENANT, { requestId: CALL_ID, leadId: LEAD, reason: "Wants to talk about an order", scriptDraft: "Hello, this is the shop.", language: "hi" });
    expect(out).toMatchObject({ replayed: true, request: { id: CALL_ID, status: "requested" } });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ request_id: CALL_ID, lead_id: LEAD, reason: "Wants to talk about an order", script_draft: "Hello, this is the shop.", language: "hi" });
  });
  it("refuses a malformed id before any request, and an answer that is not the contract", async () => {
    await expect(submitOutboxMessage("tok", TENANT, { messageId: "x", leadId: LEAD, text: "hello", language: "en", category: "info" })).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
    apiRequest.mockResolvedValue({ message: { ...PRICE_JSON, status: "weird" }, replayed: false });
    await expect(submitOutboxMessage("tok", TENANT, { messageId: MSG_PRICE, leadId: LEAD, text: "hello", language: "en", category: "info" })).rejects.toThrow(ApiContractError);
  });
});


describe("the sending settings and dispatch", () => {
  const SETTINGS = { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3 };
  it("reads the system switch, this business's automatic sending and the daily limit", async () => {
    apiRequest.mockResolvedValue(SETTINGS);
    expect(await getOutboxSettings("tok", TENANT)).toEqual({ ...SETTINGS, quiet_hours_start: 21, quiet_hours_end: 9 }); // an answer without quiet hours is the fixed 21:00 to 09:00
    expect(apiRequest).toHaveBeenCalledWith(`${base}/outbox/settings`, "tok");
    for (const bad of [{ ...SETTINGS, per_customer_daily_limit: 0 }, { ...SETTINGS, per_customer_daily_limit: 21 }, { ...SETTINGS, auto_send_enabled: "yes" }, { ...SETTINGS, platform_switch_on: null }]) expect(() => parseOutboxSettings(bad)).toThrow(ApiContractError);
  });
  it("saves only the two things the Owner may set", async () => {
    apiRequest.mockResolvedValue({ ...SETTINGS, auto_send_enabled: true });
    await putOutboxSettings("tok", TENANT, { auto_send_enabled: true, per_customer_daily_limit: 5 });
    const [, , init] = apiRequest.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ auto_send_enabled: true, per_customer_daily_limit: 5 });
  });
  it("dispatches what is due and reads how many went", async () => {
    apiRequest.mockResolvedValue({ sent: 2, failed: 1 });
    expect(await dispatchOutbox("tok", TENANT)).toMatchObject({ sent: 2, failed: 1 });
    expect(apiRequest).toHaveBeenCalledWith(`${base}/outbox/dispatch`, "tok", { method: "POST" });
    apiRequest.mockResolvedValue({ sent: "2", failed: 1 });
    await expect(dispatchOutbox("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
});

describe("job BB on the web: gloss, events, filters, counts, quiet hours, dispatch", () => {
  const MID = "11111111-aaaa-4aaa-8aaa-000000000001";
  const EVENTS = [
    { kind: "made", reason: null, reason_text: null, at: "2026-10-10T10:00:00Z", actor: { kind: "assistant", user_id: "11111111-1111-4111-8111-111111111111", name: "Asha" } },
    { kind: "held", reason: "quiet_hours", reason_text: "Waiting for the morning.", at: "2026-10-10T10:05:00Z", actor: { kind: "system", user_id: null, name: null } },
    { kind: "sent", reason: null, reason_text: null, at: "2026-10-11T03:30:00Z", actor: { kind: "worker", user_id: null, name: null } },
  ];

  it("reads the English gloss and the events (null in a list, an array in the detail); an API from before BB has neither", () => {
    expect(parseOutboxMessage(PRICE_JSON).gloss_en).toBeNull();
    expect(parseOutboxMessage(PRICE_JSON).events).toBeNull();
    const m = parseOutboxMessage({ ...PRICE_JSON, gloss_en: "We have new sarees.", events: EVENTS });
    expect(m.gloss_en).toBe("We have new sarees.");
    expect(m.events?.map((e) => [e.kind, e.actor.kind, e.actor.name])).toEqual([["made", "assistant", "Asha"], ["held", "system", null], ["sent", "worker", null]]);
    expect(parseOutboxMessage({ ...PRICE_JSON, events: null }).events).toBeNull();
  });

  it.each([
    ["an unknown event kind", [{ ...EVENTS[0], kind: "exploded" }]],
    ["an unknown actor kind", [{ ...EVENTS[0], actor: { kind: "ghost", user_id: null, name: null } }]],
    ["an event without an actor", [{ kind: "sent", reason: null, reason_text: null, at: "2026-10-11T03:30:00Z" }]],
    ["a bad time", [{ ...EVENTS[0], at: "yesterday" }]],
    ["a bad user id", [{ ...EVENTS[0], actor: { kind: "person", user_id: "x", name: null } }]],
  ])("refuses %s", (_what, events) => {
    expect(() => parseOutboxMessage({ ...PRICE_JSON, events })).toThrow(ApiContractError);
  });

  it("reads one message with its history by id, with the person's token", async () => {
    apiRequest.mockResolvedValue({ ...PRICE_JSON, id: MID, events: EVENTS });
    const m = await getOutboxMessage("tok", TENANT, MID);
    expect(apiRequest).toHaveBeenCalledWith(`${base}/outbox/messages/${MID}`, "tok");
    expect(m.events).toHaveLength(3);
    await expect(getOutboxMessage("tok", TENANT, "../x")).rejects.toThrow(ApiContractError);
  });

  it("lists with the server's filters: tab, customer, two India dates and the cursor, and never mixes them with a status", async () => {
    apiRequest.mockResolvedValue({ items: [], next_cursor: null });
    await listOutboxMessages("tok", TENANT, { tab: "blocked", customer: "  Lakshmi ", from: "2026-10-01", to: "2026-10-04", limit: 30, after: "CUR" });
    const q = new URL(`http://x${apiRequest.mock.calls[0][0]}`).searchParams;
    expect(Object.fromEntries(q)).toEqual({ limit: "30", after: "CUR", tab: "blocked", customer: "Lakshmi", from: "2026-10-01", to: "2026-10-04" });
    apiRequest.mockClear();
    await listOutboxMessages("tok", TENANT, { tab: "waiting" });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/outbox/messages?limit=30&tab=waiting`);
    apiRequest.mockClear();
    await listOutboxMessages("tok", TENANT, { status: "needs_approval", limit: 5 });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/outbox/messages?limit=5&status=needs_approval`);
    await expect(listOutboxMessages("tok", TENANT, { from: "01-10-2026" })).rejects.toThrow(ApiContractError);
    await expect(listOutboxMessages("tok", TENANT, { to: "soon" })).rejects.toThrow(ApiContractError);
  });

  it("reads the counts behind the tabs with the same filters, and refuses a count that is not a number", async () => {
    apiRequest.mockResolvedValue({ waiting: 3, scheduled: 1, sent: 7, blocked: 2, due_now: 1, held_for_later: 4 });
    expect(await getOutboxSummary("tok", TENANT, { customer: "Lak", from: "2026-10-01" })).toEqual({ waiting: 3, scheduled: 1, sent: 7, blocked: 2, due_now: 1, held_for_later: 4 });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/outbox/summary?customer=Lak&from=2026-10-01`);
    apiRequest.mockClear();
    await getOutboxSummary("tok", TENANT);
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/outbox/summary`);
    expect(() => parseOutboxSummary({ waiting: -1, scheduled: 0, sent: 0, blocked: 0, due_now: 0, held_for_later: 0 })).toThrow(ApiContractError);
    expect(() => parseOutboxSummary({ waiting: 1 })).toThrow(ApiContractError);
  });

  it("reads the quiet hours of the settings (19 to 23, 7 to 10); an API from before BB has the fixed 21:00 to 09:00; anything outside the limits is refused", () => {
    const s = { platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3 };
    expect(parseOutboxSettings({ ...s, quiet_hours_start: 22, quiet_hours_end: 8 })).toMatchObject({ quiet_hours_start: 22, quiet_hours_end: 8 });
    expect(parseOutboxSettings(s)).toMatchObject({ quiet_hours_start: 21, quiet_hours_end: 9 });
    expect([QUIET_START, QUIET_END]).toEqual([{ min: 19, max: 23 }, { min: 7, max: 10 }]);
    for (const bad of [{ quiet_hours_start: 18 }, { quiet_hours_start: 24 }, { quiet_hours_end: 6 }, { quiet_hours_end: 11 }, { quiet_hours_start: 21.5 }]) expect(() => parseOutboxSettings({ ...s, ...bad })).toThrow(ApiContractError);
  });

  it("saves the quiet hours with the sending values; a quiet hour left out is left out of the request (the API keeps it)", async () => {
    apiRequest.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: true, per_customer_daily_limit: 4, quiet_hours_start: 22, quiet_hours_end: 8 });
    await putOutboxSettings("tok", TENANT, { auto_send_enabled: true, per_customer_daily_limit: 4, quiet_hours_start: 22, quiet_hours_end: 8 });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ auto_send_enabled: true, per_customer_daily_limit: 4, quiet_hours_start: 22, quiet_hours_end: 8 });
    apiRequest.mockClear();
    await putOutboxSettings("tok", TENANT, { auto_send_enabled: false, per_customer_daily_limit: 3 });
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ auto_send_enabled: false, per_customer_daily_limit: 3 });
  });

  it("reads everything the dispatch says: sent, failed, to retry later, still due, held, and whether the system is on", async () => {
    apiRequest.mockResolvedValue({ sent: 1, failed: 2, retry_later: 3, still_due: 4, held_for_later: 5, platform_switch_on: false });
    expect(await dispatchOutbox("tok", TENANT)).toEqual({ sent: 1, failed: 2, retry_later: 3, still_due: 4, held_for_later: 5, platform_switch_on: false });
    expect(apiRequest.mock.calls[0][0]).toBe(`${base}/outbox/dispatch`);
  });

  it("an older answer (only sent and failed) reads as nothing to retry or hold, and an unknown system switch; a broken one is refused", async () => {
    apiRequest.mockResolvedValue({ sent: 2, failed: 0 });
    expect(await dispatchOutbox("tok", TENANT)).toEqual({ sent: 2, failed: 0, retry_later: 0, still_due: 0, held_for_later: 0, platform_switch_on: null });
    apiRequest.mockResolvedValue({ sent: 2, failed: 0, still_due: "many" });
    await expect(dispatchOutbox("tok", TENANT)).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValue({ failed: 0 });
    await expect(dispatchOutbox("tok", TENANT)).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValue({ sent: 1, failed: 0, platform_switch_on: "yes" });
    await expect(dispatchOutbox("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
});
