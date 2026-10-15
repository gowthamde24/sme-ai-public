import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseApproved, parseCampaign } from "@/lib/api/campaigns";
import { APPROVED_JSON, CAMPAIGN, CAMPAIGN_JSON, RECIPIENT, SHA } from "@/lib/api/campaigns-fixtures";

const api = { put: vi.fn(), ledger: vi.fn(), add: vi.fn(), clear: vi.fn(), remove: vi.fn(), approve: vi.fn(), state: vi.fn(), outcome: vi.fn(), connect: vi.fn() };
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/campaigns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/campaigns")>()),
  putCampaign: (...a: unknown[]) => api.put(...a),
  addRecipientsFromLedger: (...a: unknown[]) => api.ledger(...a),
  addRecipients: (...a: unknown[]) => api.add(...a),
  clearRecipients: (...a: unknown[]) => api.clear(...a),
  removeRecipient: (...a: unknown[]) => api.remove(...a),
  approveCampaign: (...a: unknown[]) => api.approve(...a),
  setCampaignState: (...a: unknown[]) => api.state(...a),
  recordOutcome: (...a: unknown[]) => api.outcome(...a),
  connectCall: (...a: unknown[]) => api.connect(...a),
}));

import { addFromLedgerAction, approveCampaignAction, callOutcomeAction, campaignStateAction, clearRecipientsAction, connectCallAction, importRecipientsAction, removeRecipientAction, saveCampaignAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const ITEM = "ca110000-0000-4000-8000-000000000001";
const CALL = "ca220000-0000-4000-8000-000000000001";
const input = { name: " October reminders ", kind: "payment_due" as const, language: "en" as const, waTemplateId: null, messageText: "Hello {{name}}, {{amount}} is due on {{due_date}}.", steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }], callAfterStep: 2, callWaitHours: 24 };
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
beforeEach(() => vi.clearAllMocks());

describe("saving a campaign", () => {
  it("sends the trimmed campaign with the page's id and reports whether it went back to draft", async () => {
    api.put.mockResolvedValue({ campaign: parseCampaign(CAMPAIGN_JSON), created: true, back_to_draft: true });
    expect(await saveCampaignAction(T, CAMPAIGN, input)).toEqual({ ok: true, campaignId: CAMPAIGN, backToDraft: true });
    expect(api.put).toHaveBeenCalledWith("tok", T, CAMPAIGN, { ...input, name: "October reminders" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/campaigns`);
  });
  it.each([
    ["no name", { name: "  " }], ["an unknown kind", { kind: "promotion" }], ["a text that is too short", { messageText: "Hi" }], ["a text that is too long", { messageText: "x".repeat(601) }], ["no steps", { steps: [] }], ["six steps", { steps: Array.from({ length: 6 }, (_, i) => ({ offset_days: i, time: "10:00" })) }],
    ["a step too far back", { steps: [{ offset_days: -61, time: "10:00" }] }], ["a bad time", { steps: [{ offset_days: 0, time: "25:00" }] }], ["a call step that does not exist", { callAfterStep: 3 }], ["a wait of zero hours", { callWaitHours: 0 }], ["a bad template id", { waTemplateId: "x" }],
  ])("%s never reaches the API", async (_n, over) => {
    expect(await saveCampaignAction(T, CAMPAIGN, { ...input, ...over } as never)).toEqual({ ok: false, error: "That was not accepted. Check the details and try again. Nothing was changed." });
    expect(api.put).not.toHaveBeenCalled();
  });
  it("a bad campaign id or workspace id never reaches the API", async () => {
    expect(await saveCampaignAction("x", CAMPAIGN, input)).toMatchObject({ ok: false });
    expect(await saveCampaignAction(T, "x", input)).toMatchObject({ ok: false });
    expect(api.put).not.toHaveBeenCalled();
  });
  it("a refusal is OUR sentence, never the API's; a rejected session goes to sign-in", async () => {
    api.put.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await saveCampaignAction(T, CAMPAIGN, input)).toEqual({ ok: false, error: expect.not.stringContaining("API's own") });
    api.put.mockRejectedValueOnce(new ApiAuthError());
    await expect(saveCampaignAction(T, CAMPAIGN, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the people of a campaign", () => {
  it("adds from the ledger with a checked range", async () => {
    api.ledger.mockResolvedValue({ added: 3, skipped: [], recipients: 3 });
    expect(await addFromLedgerAction(T, CAMPAIGN, { due_from: "2026-10-01", due_to: "2026-10-31", party: "company", min_open_paise: 50000 })).toEqual({ ok: true, added: 3, skipped: [], recipients: 3 });
    expect(api.ledger).toHaveBeenCalledWith("tok", T, CAMPAIGN, { due_from: "2026-10-01", due_to: "2026-10-31", party: "company", min_open_paise: 50000 });
  });
  it.each([["an impossible date", { due_from: "2026-02-30", due_to: "2026-03-31" }], ["a range that runs backwards", { due_from: "2026-11-01", due_to: "2026-10-01" }], ["a party that does not exist", { due_from: "2026-10-01", due_to: "2026-10-31", party: "robot" }], ["a minimum above the cap", { due_from: "2026-10-01", due_to: "2026-10-31", min_open_paise: 100_000_001 }]])("%s never reaches the API", async (_n, f) => {
    expect(await addFromLedgerAction(T, CAMPAIGN, f as never)).toMatchObject({ ok: false });
    expect(api.ledger).not.toHaveBeenCalled();
  });
  it("adds a list, one of contact or phone each, and drops nothing silently", async () => {
    api.add.mockResolvedValue({ added: 2, skipped: [{ row: 1, reason: "duplicate" }], recipients: 2 });
    const rows = [{ phone: "9000000001", due_date: "2026-10-20", amount_paise: 12500, reference: "INV-1" }, { contact_id: RECIPIENT, due_date: "2026-10-21" }];
    expect(await importRecipientsAction(T, CAMPAIGN, rows)).toMatchObject({ ok: true, added: 2 });
    expect(api.add).toHaveBeenCalledWith("tok", T, CAMPAIGN, rows);
  });
  it.each([
    ["no rows", []], ["both a phone and a contact", [{ phone: "9000000001", contact_id: RECIPIENT, due_date: "2026-10-20" }]], ["neither", [{ due_date: "2026-10-20" }]], ["a zero amount", [{ phone: "9000000001", due_date: "2026-10-20", amount_paise: 0 }]],
    ["a fractional amount", [{ phone: "9000000001", due_date: "2026-10-20", amount_paise: 1.5 }]], ["a bad date", [{ phone: "9000000001", due_date: "tomorrow" }]], ["more than 5,000 rows", Array.from({ length: 5001 }, () => ({ phone: "9000000001", due_date: "2026-10-20" }))],
  ])("%s never reaches the API", async (_n, rows) => {
    expect(await importRecipientsAction(T, CAMPAIGN, rows as never)).toMatchObject({ ok: false });
    expect(api.add).not.toHaveBeenCalled();
  });
  it("clears and removes", async () => {
    api.clear.mockResolvedValue(4);
    api.remove.mockResolvedValue(1);
    expect(await clearRecipientsAction(T, CAMPAIGN)).toEqual({ ok: true, removed: 4 });
    expect(await removeRecipientAction(T, CAMPAIGN, RECIPIENT)).toEqual({ ok: true });
    expect(await removeRecipientAction(T, CAMPAIGN, "x")).toMatchObject({ ok: false });
  });
});

describe("approving", () => {
  it("passes the hash of the samples the Owner read and says what was planned", async () => {
    api.approve.mockResolvedValue(parseApproved(APPROVED_JSON));
    expect(await approveCampaignAction(T, CAMPAIGN, SHA)).toEqual({ ok: true, planned: 54, past: 2, sendingOn: true });
    expect(api.approve).toHaveBeenCalledWith("tok", T, CAMPAIGN, SHA);
  });
  it("a hash that is not a hash never reaches the API", async () => {
    expect(await approveCampaignAction(T, CAMPAIGN, "abc")).toMatchObject({ ok: false });
    expect(api.approve).not.toHaveBeenCalled();
  });
  it("a campaign that changed since the samples were read says so and asks for a fresh read", async () => {
    api.approve.mockRejectedValue(refusal(409, "samples_changed"));
    expect(await approveCampaignAction(T, CAMPAIGN, SHA)).toEqual({ ok: false, error: expect.stringContaining("changed after you read"), changed: true });
  });
  it("a missing second factor points at the Security page; a campaign not ready is named", async () => {
    api.approve.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await approveCampaignAction(T, CAMPAIGN, SHA)).toMatchObject({ ok: false, mfa: true });
    api.approve.mockRejectedValueOnce(refusal(409, "campaign_not_ready"));
    expect(await approveCampaignAction(T, CAMPAIGN, SHA)).toEqual({ ok: false, error: expect.stringContaining("not ready") });
  });
  it("asking twice is the API's to answer: nothing here sends twice", async () => {
    api.approve.mockResolvedValue(parseApproved(APPROVED_JSON));
    await approveCampaignAction(T, CAMPAIGN, SHA);
    await approveCampaignAction(T, CAMPAIGN, SHA);
    expect(api.approve).toHaveBeenCalledTimes(2);
  });
});

describe("pause, resume, cancel", () => {
  it("passes only the three words", async () => {
    api.state.mockResolvedValue(parseCampaign(CAMPAIGN_JSON));
    for (const a of ["pause", "resume", "cancel"] as const) expect(await campaignStateAction(T, CAMPAIGN, a)).toEqual({ ok: true });
    expect(await campaignStateAction(T, CAMPAIGN, "delete" as never)).toMatchObject({ ok: false });
    expect(api.state).toHaveBeenCalledTimes(3);
  });
  it("a campaign in the wrong state is a plain sentence", async () => {
    api.state.mockRejectedValue(refusal(409, "campaign_state"));
    expect(await campaignStateAction(T, CAMPAIGN, "pause")).toEqual({ ok: false, error: expect.stringContaining("not in a state") });
  });
});

describe("the call list", () => {
  it("writes down an outcome; a promise needs its date and a call later its time", async () => {
    api.outcome.mockResolvedValue({ id: ITEM, status: "done", outcome: "paid", replayed: false });
    expect(await callOutcomeAction(T, ITEM, { outcome: "paid" })).toEqual({ ok: true });
    expect(await callOutcomeAction(T, ITEM, { outcome: "promised", promisedOn: "2026-10-25" })).toEqual({ ok: true });
    expect(await callOutcomeAction(T, ITEM, { outcome: "call_later", callAfter: "2026-10-20T10:00:00+05:30" })).toEqual({ ok: true });
    expect(await callOutcomeAction(T, ITEM, { outcome: "promised" })).toMatchObject({ ok: false });
    expect(await callOutcomeAction(T, ITEM, { outcome: "call_later" })).toMatchObject({ ok: false });
    expect(await callOutcomeAction(T, ITEM, { outcome: "paid", promisedOn: "2026-10-25" })).toMatchObject({ ok: false });
    expect(await callOutcomeAction(T, ITEM, { outcome: "sold" as never })).toMatchObject({ ok: false });
    expect(api.outcome).toHaveBeenCalledTimes(3);
  });
  it("connects a call through the bridge and names each refusal in words of ours", async () => {
    api.connect.mockResolvedValue({ bridge_id: "b", status: "ringing", replayed: true });
    expect(await connectCallAction(T, CALL)).toEqual({ ok: true, replayed: true });
    api.connect.mockRejectedValueOnce(refusal(409, "outside_calling_hours"));
    expect(await connectCallAction(T, CALL)).toEqual({ ok: false, error: expect.stringContaining("9 am to 9 pm") });
    api.connect.mockRejectedValueOnce(refusal(422, "customer_phone_unusable"));
    expect(await connectCallAction(T, CALL)).toEqual({ ok: false, error: expect.stringContaining("wrong number") });
    api.connect.mockRejectedValueOnce(refusal(502, "call_provider_failed"));
    expect(await connectCallAction(T, CALL)).toEqual({ ok: false, error: expect.stringContaining("could not be started") });
    api.connect.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await connectCallAction(T, CALL)).toMatchObject({ ok: false });
    expect(await connectCallAction(T, "x")).toMatchObject({ ok: false });
  });
});
