import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import {
  approveDraft,
  approveQuestionDraft,
  createDraft,
  createPolicyVersion,
  discardDraft,
  discardQuestionDraft,
  fetchDraft,
  fetchDrafts,
  fetchDueList,
  fetchLeadFollowup,
  fetchPolicyVersions,
  fetchQuestionDrafts,
  parseDraft,
  parseDueItems,
  parseGate,
  parseLeadFollowup,
  parsePolicyVersion,
  parseQuestionDraft,
  parseTouch,
  recordSent,
  recordTouch,
  syncQuestionDrafts,
} from "./followups";
import {
  CHANNELS_OPEN_JSON,
  DECISION_JSON,
  DRAFT,
  DRAFT_JSON,
  DRAFT_RESULT_JSON,
  DUE_JSON,
  DUE_OLD_JSON,
  FOLLOWUP_JSON,
  FOLLOWUP_OLD_JSON,
  HASH,
  LEAD,
  POLICY,
  POLICY_JSON,
  POLICY_RESULT_JSON,
  QUESTION,
  QUESTION_DECISION_JSON,
  QUESTION_JSON,
  QUESTION_SYNC_JSON,
  REQ,
  SENT_JSON,
  STATUS_JSON,
  TENANT,
  TOUCH,
  TOUCH2,
  TOUCH_JSON,
  TOUCH_RESULT_JSON,
} from "./followups-fixtures";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

const call = () => apiRequest.mock.calls[0] as [string, string, RequestInit | undefined];
const sentBody = () => JSON.parse(String(call()[2]?.body ?? "null")) as Record<string, unknown>;
/** Names a body may NEVER carry: wording, a contact, a tenant, a status, an approver, an engine text. */
const FORBIDDEN = ["body", "text", "wording", "message", "contact_id", "contact", "tenant_id", "status", "approved_by", "created_by", "request_text", "result_text", "template_code", "touch_number", "state"];

describe("request shapes: the lead names the contact, the URL names the tenant, the token names the approver", () => {
  it("a draft is asked for with an id and a channel and nothing else", async () => {
    apiRequest.mockResolvedValue(DRAFT_RESULT_JSON);
    await createDraft("tok", TENANT, LEAD, { id: DRAFT, channel: "whatsapp" });
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/leads/${LEAD}/followup-drafts`);
    expect(call()[1]).toBe("tok");
    expect(call()[2]?.method).toBe("POST");
    expect(sentBody()).toEqual({ id: DRAFT, channel: "whatsapp" });
  });

  it("a touch is the person's inputs only; no time means NOW (the field is absent, never an empty string or a guess)", async () => {
    apiRequest.mockResolvedValue(TOUCH_RESULT_JSON);
    await recordTouch("tok", TENANT, LEAD, { id: TOUCH, direction: "out", channel: "email" });
    expect(sentBody()).toEqual({ id: TOUCH, direction: "out", channel: "email" });
    expect("occurred_at" in sentBody()).toBe(false);
    apiRequest.mockClear();
    await recordTouch("tok", TENANT, LEAD, { id: TOUCH, direction: "in", channel: "phone", occurredAt: "2026-10-05T04:30:00.000Z" });
    expect(sentBody()).toEqual({ id: TOUCH, direction: "in", channel: "phone", occurred_at: "2026-10-05T04:30:00.000Z" });
  });

  it("an approval carries the fingerprint the person reviewed and nothing else", async () => {
    apiRequest.mockResolvedValue(STATUS_JSON);
    await approveDraft("tok", TENANT, DRAFT, HASH);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/followup-drafts/${DRAFT}/approve`);
    expect(sentBody()).toEqual({ state_hash: HASH });
    await expect(approveDraft("tok", TENANT, DRAFT, "nothex")).rejects.toThrow(ApiContractError);
    await expect(approveDraft("tok", TENANT, DRAFT, HASH.toUpperCase())).rejects.toThrow(ApiContractError);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("discard and the question decisions have no body; 'I sent it' has a touch id and an optional time", async () => {
    apiRequest.mockResolvedValue(STATUS_JSON);
    await discardDraft("tok", TENANT, DRAFT);
    expect(call()[2]).toEqual({ method: "POST" });
    apiRequest.mockClear();
    apiRequest.mockResolvedValue(SENT_JSON);
    await recordSent("tok", TENANT, DRAFT, { touchId: TOUCH2 });
    expect(sentBody()).toEqual({ touch_id: TOUCH2 });
    apiRequest.mockClear();
    await recordSent("tok", TENANT, DRAFT, { touchId: TOUCH2, occurredAt: "2026-10-07T05:00:00.000Z" });
    expect(sentBody()).toEqual({ touch_id: TOUCH2, occurred_at: "2026-10-07T05:00:00.000Z" });
    apiRequest.mockClear();
    apiRequest.mockResolvedValue(QUESTION_DECISION_JSON);
    await approveQuestionDraft("tok", TENANT, QUESTION);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/question-drafts/${QUESTION}/approve`);
    expect(call()[2]).toEqual({ method: "POST" });
    apiRequest.mockClear();
    await discardQuestionDraft("tok", TENANT, QUESTION);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/question-drafts/${QUESTION}/discard`);
  });

  it("a policy is the policy and nothing else", async () => {
    apiRequest.mockResolvedValue(POLICY_RESULT_JSON);
    await createPolicyVersion("tok", TENANT, { id: POLICY, effectiveFrom: "2026-10-08", gapDays: [3, 7], maxTouches: 3, quietStart: "21:00", quietEnd: "09:00", allowedWeekdays: [0, 1, 2], holidays: ["2026-12-25"], minGapHours: 24, recipientUtcOffsetMinutes: 330 });
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/followup-policy-versions`);
    expect(sentBody()).toEqual({ id: POLICY, effective_from: "2026-10-08", gap_days: [3, 7], max_touches: 3, quiet_start: "21:00", quiet_end: "09:00", allowed_weekdays: [0, 1, 2], holidays: ["2026-12-25"], min_gap_hours: 24, recipient_utc_offset_minutes: 330 });
  });

  it("no body of any write carries wording, a contact, a tenant, a status or an approver", async () => {
    const writes: [string, () => Promise<unknown>, unknown][] = [
      ["draft", () => createDraft("t", TENANT, LEAD, { id: DRAFT, channel: "email" }), DRAFT_RESULT_JSON],
      ["touch", () => recordTouch("t", TENANT, LEAD, { id: TOUCH, direction: "out", channel: "email", occurredAt: "2026-10-05T04:30:00.000Z" }), TOUCH_RESULT_JSON],
      ["approve", () => approveDraft("t", TENANT, DRAFT, HASH), STATUS_JSON],
      ["sent", () => recordSent("t", TENANT, DRAFT, { touchId: TOUCH2, occurredAt: "2026-10-05T04:30:00.000Z" }), SENT_JSON],
      ["policy", () => createPolicyVersion("t", TENANT, { id: POLICY, effectiveFrom: "2026-10-08", gapDays: [3], maxTouches: 2, quietStart: "21:00", quietEnd: "09:00", allowedWeekdays: [0], holidays: [], minGapHours: 0, recipientUtcOffsetMinutes: 330 }), POLICY_RESULT_JSON],
    ];
    for (const [name, run, answer] of writes) {
      apiRequest.mockClear();
      apiRequest.mockResolvedValue(answer);
      await run();
      const keys = Object.keys(sentBody());
      expect(keys.filter((k) => FORBIDDEN.includes(k)), name).toEqual([]);
    }
  });

  it("an id that is not a canonical UUID never reaches a path", async () => {
    for (const run of [
      () => fetchLeadFollowup("t", TENANT, "../x"),
      () => recordTouch("t", "x", LEAD, { id: TOUCH, direction: "out", channel: "email" }),
      () => createDraft("t", TENANT, LEAD, { id: "x", channel: "email" }),
      () => discardDraft("t", TENANT, "x"),
      () => fetchDraft("t", TENANT, "x"),
      () => recordSent("t", TENANT, DRAFT, { touchId: "x" }),
      () => fetchDrafts("t", TENANT, { leadId: "x" }),
      () => syncQuestionDrafts("t", TENANT, "x"),
      () => approveQuestionDraft("t", TENANT, "x"),
    ])
      await expect(run()).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  it("each read asks the API for its own path with the token", async () => {
    apiRequest.mockResolvedValue(FOLLOWUP_JSON);
    await fetchLeadFollowup("tok", TENANT, LEAD, "whatsapp");
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/leads/${LEAD}/followup?channel=whatsapp`);
    apiRequest.mockClear();
    apiRequest.mockResolvedValue(DUE_JSON);
    await fetchDueList("tok", TENANT);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/followups/due`);
    apiRequest.mockClear();
    apiRequest.mockResolvedValue([POLICY_JSON]);
    expect(await fetchPolicyVersions("tok", TENANT)).toHaveLength(1);
    apiRequest.mockClear();
    apiRequest.mockResolvedValue([DRAFT_JSON]);
    await fetchDrafts("tok", TENANT, { leadId: LEAD, status: "active", limit: 5 });
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/followup-drafts?limit=5&lead_id=${LEAD}&status=active`);
    apiRequest.mockClear();
    apiRequest.mockResolvedValue([QUESTION_JSON]);
    await fetchQuestionDrafts("tok", TENANT, REQ, false);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/requirements/${REQ}/question-drafts?active_only=false`);
    apiRequest.mockClear();
    apiRequest.mockResolvedValue(QUESTION_SYNC_JSON);
    expect((await syncQuestionDrafts("tok", TENANT, REQ)).changed).toBe(1);
    expect(call()[2]).toEqual({ method: "POST" });
  });
});

describe("parsing: a body that does not match the contract is an error, never rendered", () => {
  it("accepts the fixtures and keeps every field", () => {
    expect(parseLeadFollowup(FOLLOWUP_JSON).drafts[0].state_hash).toBe(HASH);
    expect(parseLeadFollowup({ ...FOLLOWUP_JSON, decision: null }).decision).toBeNull();
    expect(parseDraft(DRAFT_JSON).body).toContain("following up");
    expect(parseDueItems(DUE_JSON)[0].open_draft_id).toBeNull();
    expect(parsePolicyVersion(POLICY_JSON).holidays).toEqual(["2026-12-25"]);
    expect(parseQuestionDraft(QUESTION_JSON).line_no).toBe(0);
    expect(parseTouch(TOUCH_JSON).direction).toBe("out");
    expect(parseGate({ blocked: "key", stopped: "order_accepted", policy_in_force: false }).blocked).toBe("key");
  });

  it.each([
    ["a status outside the list", () => parseDraft({ ...DRAFT_JSON, status: "sent" })],
    ["a channel outside the list", () => parseDraft({ ...DRAFT_JSON, channel: "sms" })],
    ["a missing body", () => parseDraft({ ...DRAFT_JSON, body: undefined })],
    ["a number as a hash", () => parseDraft({ ...DRAFT_JSON, state_hash: 5 })],
    ["a fraction", () => parseDraft({ ...DRAFT_JSON, touch_number: 2.5 })],
    ["a discard code outside the list", () => parseDraft({ ...DRAFT_JSON, discard_code: "because" })],
    ["a direction outside the list", () => parseTouch({ ...TOUCH_JSON, direction: "sideways" })],
    ["a gate without its flag", () => parseGate({ blocked: null, stopped: null })],
    ["an action outside the list", () => parseDueItems([{ ...DUE_JSON[0], action: "send" }])],
    ["a decision with an unknown action", () => parseLeadFollowup({ ...FOLLOWUP_JSON, decision: { ...DECISION_JSON, action: "send" } })],
    ["a list that is not a list", () => parseDueItems({})],
    ["a question status outside the list", () => parseQuestionDraft({ ...QUESTION_JSON, status: "sent" })],
    ["a policy whose weekdays are text", () => parsePolicyVersion({ ...POLICY_JSON, allowed_weekdays: ["Monday"] })],
  ])("%s", (_name, run) => expect(run).toThrow(ApiContractError));
});

describe("the channel fields (WhatsApp as a first-class channel)", () => {
  it("keeps what the API sent: the state of each channel, the default and the channel of the open draft", () => {
    const blocked = [{ channel: "email", blocked: "consent" }, { channel: "whatsapp", blocked: null }];
    const page = parseLeadFollowup({ ...FOLLOWUP_JSON, channel: "whatsapp", default_channel: "whatsapp", channels: blocked });
    expect(page.channel).toBe("whatsapp");
    expect(page.default_channel).toBe("whatsapp");
    expect(page.channels).toEqual(blocked);
    const [row] = parseDueItems([{ ...DUE_JSON[0], open_draft_id: DRAFT, open_draft_channel: "whatsapp", channels: blocked, default_channel: "whatsapp" }]);
    expect(row).toMatchObject({ open_draft_id: DRAFT, open_draft_channel: "whatsapp", default_channel: "whatsapp", channels: blocked });
    expect(parseDueItems(DUE_JSON)[0]).toMatchObject({ open_draft_channel: null, default_channel: "email", channels: CHANNELS_OPEN_JSON });
  });

  it("a response WITHOUT the new fields (an older API) still parses, with explicit defaults", () => {
    expect("channels" in FOLLOWUP_OLD_JSON || "default_channel" in FOLLOWUP_OLD_JSON).toBe(false);
    expect(DUE_OLD_JSON.every((row) => !("channels" in row) && !("default_channel" in row) && !("open_draft_channel" in row))).toBe(true);
    const page = parseLeadFollowup(FOLLOWUP_OLD_JSON);
    expect(page.channels).toEqual([]);
    expect(page.default_channel).toBe(page.channel); // the channel the API answered for
    expect(parseLeadFollowup({ ...FOLLOWUP_OLD_JSON, channel: "whatsapp" }).default_channel).toBe("whatsapp");
    expect(page.drafts[0].state_hash).toBe(HASH); // nothing else changed
    const [row] = parseDueItems(DUE_OLD_JSON);
    expect(row).toMatchObject({ channels: [], default_channel: "email", open_draft_channel: null, open_draft_id: null }); // an older API judged e-mail only
  });

  it("the fields are not mixed up: one new field absent, the others kept", () => {
    expect(parseLeadFollowup({ ...FOLLOWUP_JSON, channel: "whatsapp", default_channel: undefined }).default_channel).toBe("whatsapp");
    expect(parseLeadFollowup({ ...FOLLOWUP_JSON, channels: undefined }).channels).toEqual([]);
    expect(parseDueItems([{ ...DUE_JSON[0], open_draft_channel: undefined }])[0].channels).toEqual(CHANNELS_OPEN_JSON);
  });

  it.each([
    ["a default channel outside the list", () => parseLeadFollowup({ ...FOLLOWUP_JSON, default_channel: "sms" })],
    ["a default channel that is null", () => parseLeadFollowup({ ...FOLLOWUP_JSON, default_channel: null })],
    ["a phone call as a draft channel", () => parseLeadFollowup({ ...FOLLOWUP_JSON, default_channel: "phone" })],
    ["channels that are not a list", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: {} })],
    ["channels that are null", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: null })],
    ["a channel state outside the list", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: [{ channel: "sms", blocked: null }] })],
    ["a phone call as a channel state (it is a touch, never a draft channel)", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: [{ channel: "phone", blocked: null }] })],
    ["a phone call as a channel state of a due row", () => parseDueItems([{ ...DUE_JSON[0], channels: [{ channel: "phone", blocked: null }] }])],
    ["a channel state without its blocked word", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: [{ channel: "email" }] })],
    ["a blocked word that is a number", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: [{ channel: "email", blocked: 5 }] })],
    ["the same channel twice", () => parseLeadFollowup({ ...FOLLOWUP_JSON, channels: [{ channel: "email", blocked: null }, { channel: "email", blocked: "key" }] })],
    ["a due row with a default channel outside the list", () => parseDueItems([{ ...DUE_JSON[0], default_channel: "sms" }])],
    ["a due row with an open-draft channel outside the list", () => parseDueItems([{ ...DUE_JSON[0], open_draft_channel: "phone" }])],
    ["a due row with channels that are text", () => parseDueItems([{ ...DUE_JSON[0], channels: "email" }])],
  ])("%s is an error", (_name, run) => expect(run).toThrow(ApiContractError));

  it("an unset channel leaves the choice to the API; a stated one is sent", async () => {
    apiRequest.mockResolvedValue(FOLLOWUP_JSON);
    await fetchLeadFollowup("tok", TENANT, LEAD);
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/leads/${LEAD}/followup`);
    apiRequest.mockClear();
    await fetchLeadFollowup("tok", TENANT, LEAD, "email");
    expect(call()[0]).toBe(`/v1/tenants/${TENANT}/leads/${LEAD}/followup?channel=email`);
  });
});

describe("the answer for a lead the database has stopped", () => {
  it("parses: action stop, the stop reason as the reason code, terminal, no touch number, no engine behind it", () => {
    const page = parseLeadFollowup({
      ...FOLLOWUP_JSON,
      gate: { ...FOLLOWUP_JSON.gate, stopped: "order_accepted" },
      decision: { action: "stop", reason_code: "order_accepted", terminal: true, touch_number: null, next_eligible_at: null, engine_version: "none" },
    });
    expect(page.decision).toMatchObject({ action: "stop", reason_code: "order_accepted", terminal: true, touch_number: null, next_eligible_at: null });
    expect(page.gate.stopped).toBe("order_accepted");
  });
});
