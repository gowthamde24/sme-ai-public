import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import {
  addRecipients, addRecipientsFromLedger, approveCampaign, clearRecipients, connectCall, getCallList, getCampaign, getPreview, getResults, listCampaigns, listRecipients, parseCallItem, parseCampaign, parseDetail, parsePreview, parseRecipient,
  parseResults, putCampaign, recordOutcome, removeRecipient, setCampaignState,
} from "./campaigns";
import { ADDED_JSON, APPROVED_JSON, BRIDGE_JSON, CALL_ITEM, CALL_ITEM_JSON, CALL_LIST_JSON, CALL_REQUEST, CAMPAIGN, CAMPAIGN_JSON, DETAIL_ISSUES_JSON, DETAIL_JSON, LIST_JSON, OUTCOME_JSON, PREVIEW_JSON, RECIPIENT, RECIPIENT_JSON, RECIPIENTS_JSON, RESULTS_JSON, SAVED_JSON, SHA, TEMPLATE } from "./campaigns-fixtures";

const T = "22222222-2222-2222-2222-222222222222";
const base = `/v1/tenants/${T}`;
beforeEach(() => vi.clearAllMocks());

describe("a campaign as the API sends it", () => {
  it("reads the kind, the text, the steps, the call plan and the totals", () => {
    expect(parseCampaign(CAMPAIGN_JSON)).toMatchObject({ kind: "payment_due", status: "draft", steps: [{ offset_days: -3, time: "10:00" }, { offset_days: 0, time: "10:00" }, { offset_days: 7, time: "11:00" }], call_after_step: 3, call_wait_hours: 24, recipients: 18, total_amount_paise: 41250000 });
  });
  it("carries what stands in the way of the approval, with our fixed sentence for each", () => {
    expect(parseDetail(DETAIL_ISSUES_JSON)).toMatchObject({ issues: ["no_template", "step_in_quiet_hours"], sending_on: false, wa_template_id: null });
    expect(parseDetail(DETAIL_JSON).issues).toEqual([]);
  });
  it.each([["kind", "promotion"], ["status", "sent"], ["language", "fr"], ["steps", [{ offset_days: 500, time: "10:00" }]], ["steps", [{ offset_days: 0, time: "25:00" }]], ["recipients", -1], ["name", ""], ["call_wait_hours", 0], ["wa_template_id", "x"]])("a campaign with %s = %j is a contract error", (key, value) => {
    expect(() => parseCampaign({ ...CAMPAIGN_JSON, [key]: value })).toThrow(ApiContractError);
  });
  it("reads the samples with their labels and the hash that approving must carry", () => {
    const p = parsePreview(PREVIEW_JSON);
    expect(p.samples.map((s) => s.labels)).toEqual([["first", "highest_amount"], ["longest"], ["random"]]);
    expect(p.samples_sha256).toBe(SHA);
    expect(() => parsePreview({ ...PREVIEW_JSON, samples_sha256: "abc" })).toThrow(ApiContractError);
    expect(() => parsePreview({ ...PREVIEW_JSON, samples: [{ ...PREVIEW_JSON.samples[0], labels: ["lucky"] }] })).toThrow(ApiContractError);
  });
  it("reads recipients, results and call items", () => {
    expect(parseRecipient(RECIPIENT_JSON)).toMatchObject({ contact_name: "Ravi Kumar (synthetic)", amount_paise: 12500000, steps: [{ step_no: 1, status: "submitted" }, { step_no: 2, status: "planned" }] });
    expect(() => parseRecipient({ ...RECIPIENT_JSON, closed_reason: "bored" })).toThrow(ApiContractError);
    expect(parseResults(RESULTS_JSON)).toMatchObject({ delivered_total: 20, replied: 4, paid_after_reminder: { recipients: 5, amount_paise: 9200000 }, by_reason: { no_opt_in: 2 }, calls: { open: 3, done: 2 } });
    expect(() => parseResults({ ...RESULTS_JSON, by_state: { sent: "many" } })).not.toThrow();
    expect(parseCallItem(CALL_ITEM_JSON)).toMatchObject({ contact_name: "Ravi Kumar (synthetic)", status: "open", outcome: null });
    expect(() => parseCallItem({ ...CALL_ITEM_JSON, outcome: "ghosted" })).toThrow(ApiContractError);
    expect(JSON.stringify(parseCallItem(CALL_ITEM_JSON))).not.toMatch(/phone|number|\+91/i);
  });
});

describe("the calls", () => {
  it("lists campaigns by status", async () => {
    apiRequest.mockResolvedValue(LIST_JSON);
    await listCampaigns("tok", T, { status: "running", after: "c", limit: 10 });
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/campaigns?limit=10&status=running&after=c`, "tok");
    apiRequest.mockResolvedValueOnce(DETAIL_JSON);
    await getCampaign("tok", T, CAMPAIGN);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/campaigns/${CAMPAIGN}`, "tok");
  });
  it("saves the whole campaign; the template and the call plan only when there are some", async () => {
    apiRequest.mockResolvedValue(SAVED_JSON);
    const input = { name: "Oct", kind: "payment_due" as const, language: "en" as const, waTemplateId: TEMPLATE, messageText: "Hello {{name}}, {{amount}} due {{due_date}}", steps: [{ offset_days: 0, time: "10:00" }], callAfterStep: null, callWaitHours: 24 };
    await putCampaign("tok", T, CAMPAIGN, input);
    expect(apiRequest.mock.calls[0][2].method).toBe("PUT");
    expect(JSON.parse(apiRequest.mock.calls[0][2].body)).toEqual({ name: "Oct", kind: "payment_due", language: "en", message_text: input.messageText, steps: input.steps, call_wait_hours: 24, wa_template_id: TEMPLATE });
    await putCampaign("tok", T, CAMPAIGN, { ...input, waTemplateId: null, callAfterStep: 2 });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).toMatchObject({ call_after_step: 2 });
    expect(JSON.parse(apiRequest.mock.calls[1][2].body)).not.toHaveProperty("wa_template_id");
  });
  it("adds people by rows (at most 5,000) or from the ledger, reads them, takes one off or all", async () => {
    apiRequest.mockResolvedValue(ADDED_JSON);
    const out = await addRecipients("tok", T, CAMPAIGN, [{ phone: "+91 90000 20001", due_date: "2026-10-20", amount_paise: 100 }]);
    expect(out.skipped).toEqual([{ row: 3, reason: "party_not_found" }, { row: 9, reason: "no_phone" }]);
    await expect(addRecipients("tok", T, CAMPAIGN, [])).rejects.toThrow(ApiContractError);
    await expect(addRecipients("tok", T, CAMPAIGN, Array.from({ length: 5001 }, () => ({ phone: "+91 90000 20001", due_date: "2026-10-20" })))).rejects.toThrow(ApiContractError);
    await addRecipientsFromLedger("tok", T, CAMPAIGN, { due_from: "2026-10-01", due_to: "2026-10-31", party: "company", min_open_paise: 100 });
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/campaigns/${CAMPAIGN}/recipients/from-ledger`);
    await expect(addRecipientsFromLedger("tok", T, CAMPAIGN, { due_from: "soon", due_to: "2026-10-31" })).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValueOnce(RECIPIENTS_JSON);
    expect(await listRecipients("tok", T, CAMPAIGN, { after: 5, limit: 20 })).toHaveLength(2);
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/campaigns/${CAMPAIGN}/recipients?limit=20&after=5`);
    apiRequest.mockResolvedValueOnce({ removed: 16 });
    expect(await clearRecipients("tok", T, CAMPAIGN)).toBe(16);
    apiRequest.mockResolvedValueOnce({ removed: 1 });
    expect(await removeRecipient("tok", T, CAMPAIGN, RECIPIENT)).toBe(1);
  });
  it("previews, approves with the hash of what was seen (a hash that is not a hash never goes), and changes the state", async () => {
    apiRequest.mockResolvedValueOnce(PREVIEW_JSON);
    await getPreview("tok", T, CAMPAIGN);
    expect(apiRequest).toHaveBeenLastCalledWith(`${base}/campaigns/${CAMPAIGN}/preview`, "tok");
    apiRequest.mockResolvedValueOnce(APPROVED_JSON);
    const done = await approveCampaign("tok", T, CAMPAIGN, SHA);
    expect(done).toMatchObject({ planned_steps: 54, past_steps: 2, sending_on: true });
    expect(JSON.parse(apiRequest.mock.calls.at(-1)![2].body)).toEqual({ samples_sha256: SHA });
    await expect(approveCampaign("tok", T, CAMPAIGN, "nope")).rejects.toThrow(ApiContractError);
    apiRequest.mockResolvedValueOnce(CAMPAIGN_JSON);
    await setCampaignState("tok", T, CAMPAIGN, "pause");
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/campaigns/${CAMPAIGN}/pause`);
    apiRequest.mockResolvedValueOnce(RESULTS_JSON);
    await getResults("tok", T, CAMPAIGN);
  });
  it("reads the call list, writes an outcome and starts the bridge", async () => {
    apiRequest.mockResolvedValueOnce(CALL_LIST_JSON);
    expect((await getCallList("tok", T, { status: "open", limit: 5 })).items).toHaveLength(2);
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/call-list?status=open&limit=5`);
    apiRequest.mockResolvedValueOnce(OUTCOME_JSON);
    await recordOutcome("tok", T, CALL_ITEM, { outcome: "promised", promisedOn: "2026-10-30" });
    expect(JSON.parse(apiRequest.mock.calls.at(-1)![2].body)).toEqual({ outcome: "promised", promised_on: "2026-10-30" });
    apiRequest.mockResolvedValueOnce(BRIDGE_JSON);
    expect((await connectCall("tok", T, CALL_REQUEST)).status).toBe("ringing");
    expect(apiRequest.mock.calls.at(-1)![0]).toBe(`${base}/call-requests/${CALL_REQUEST}/connect`);
  });
});
