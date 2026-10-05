import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = {
  captureEnquiry: vi.fn(),
  startRequirementRun: vi.fn(),
  decideField: vi.fn(),
  addField: vi.fn(),
  confirmRequirement: vi.fn(),
  discardRequirement: vi.fn(),
};
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/enquiries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/enquiries")>()),
  captureEnquiry: (...a: unknown[]) => api.captureEnquiry(...a),
  startRequirementRun: (...a: unknown[]) => api.startRequirementRun(...a),
  decideField: (...a: unknown[]) => api.decideField(...a),
  addField: (...a: unknown[]) => api.addField(...a),
  confirmRequirement: (...a: unknown[]) => api.confirmRequirement(...a),
  discardRequirement: (...a: unknown[]) => api.discardRequirement(...a),
}));

import {
  addFieldAction,
  captureEnquiryAction,
  confirmRequirementAction,
  decideFieldAction,
  discardRequirementAction,
  extractRequirementAction,
} from "./actions";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "33333333-3333-3333-3333-333333333333";
const ENQ = "44444444-4444-4444-4444-444444444444";
const FIELD = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const RUN = "77777777-7777-4777-8777-777777777777";
const CANARY = "CANARY-9f21b7";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const capture = (over: Record<string, string> = {}) =>
  captureEnquiryAction(TENANT, LEAD, undefined, form({ enquiry_id: ENQ, channel: "whatsapp", received_at: "2026-10-05T10:00:00.000Z", text: "Need 20 sarees", ...over }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
  api.captureEnquiry.mockResolvedValue({ enquiry: { id: ENQ }, text_changed: false, truncated: false });
  api.startRequirementRun.mockResolvedValue({});
  api.decideField.mockResolvedValue({});
  api.addField.mockResolvedValue({});
  api.confirmRequirement.mockResolvedValue({});
  api.discardRequirement.mockResolvedValue({});
});

describe("captureEnquiryAction", () => {
  it("authenticates first, sends the page's id, the channel, the instant and the text, and goes to the enquiry", async () => {
    const target = await redirectTarget(() => capture());
    expect(target).toBe(`/app/tenants/${TENANT}/enquiries/${ENQ}?captured=stored`);
    expect(api.captureEnquiry).toHaveBeenCalledWith("tok", TENANT, LEAD, { id: ENQ, channel: "whatsapp", receivedAt: "2026-10-05T10:00:00.000Z", subject: null, text: "Need 20 sarees" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/leads/${LEAD}`);
  });

  it("tells the page whether the text was changed or cut", async () => {
    api.captureEnquiry.mockResolvedValue({ enquiry: { id: ENQ }, text_changed: true, truncated: false });
    expect(await redirectTarget(() => capture())).toMatch(/captured=changed$/);
    api.captureEnquiry.mockResolvedValue({ enquiry: { id: ENQ }, text_changed: true, truncated: true });
    expect(await redirectTarget(() => capture())).toMatch(/captured=truncated$/);
  });

  it("validates before it calls the API, with short messages", async () => {
    expect((await capture({ enquiry_id: "x" }))?.error).toMatch(/out of date/);
    expect((await capture({ channel: "fax" }))?.error).toMatch(/where the enquiry came from/);
    expect((await capture({ text: "   " }))?.error).toMatch(/Paste the enquiry text/);
    expect((await capture({ text: "x".repeat(200_001) }))?.error).toMatch(/too long/);
    expect((await capture({ received_at: "not a date" }))?.error).toMatch(/when the enquiry was received/);
    expect((await capture({ subject: "s".repeat(2001) }))?.error).toMatch(/subject is too long/);
    expect(api.captureEnquiry).not.toHaveBeenCalled();
    expect(await captureEnquiryAction("x", LEAD, undefined, form({}))).toEqual({ ok: false, error: "This lead is not available." });
  });

  it("maps failures to our own sentences and never echoes the API's or the customer's words", async () => {
    api.captureEnquiry.mockRejectedValue(new ApiRequestError(422, "empty_enquiry", `${CANARY} from the API`));
    const r = await capture({ text: `${CANARY} text` });
    expect(r?.error).toMatch(/no text left/);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    api.captureEnquiry.mockRejectedValue(new ApiRequestError(403, "forbidden", CANARY));
    expect((await capture())?.error).toMatch(/Only an owner, admin or sales/);
    api.captureEnquiry.mockRejectedValue(new Error(CANARY));
    expect(JSON.stringify(await capture())).not.toContain(CANARY);
    api.captureEnquiry.mockRejectedValue(new ApiAuthError("x"));
    expect(await redirectTarget(() => capture())).toBe("/login");
  });
});

describe("extractRequirementAction", () => {
  it("starts a run with the page's id", async () => {
    const r = await extractRequirementAction(TENANT, ENQ, undefined, form({ run_id: RUN }));
    expect(r?.ok).toBe(true);
    expect(api.startRequirementRun).toHaveBeenCalledWith("tok", TENANT, { id: RUN, enquiryId: ENQ });
    expect((await extractRequirementAction(TENANT, ENQ, undefined, form({ run_id: "x" })))?.error).toMatch(/out of date/);
  });

  it("says why it could not start", async () => {
    api.startRequirementRun.mockRejectedValue(new ApiRequestError(429, "cost_cap_reached", CANARY));
    expect((await extractRequirementAction(TENANT, ENQ, undefined, form({ run_id: RUN })))?.error).toMatch(/spending limit/);
    api.startRequirementRun.mockRejectedValue(new ApiRequestError(409, "requirement_confirmed", CANARY));
    expect((await extractRequirementAction(TENANT, ENQ, undefined, form({ run_id: RUN })))?.error).toMatch(/Discard it first/);
  });
});

describe("decideFieldAction", () => {
  const run = (values: Record<string, string>) => decideFieldAction(TENANT, ENQ, FIELD, undefined, form(values));

  it("confirm and reject carry no value; a correction carries the person's words", async () => {
    expect((await run({ decision: "confirm", value: CANARY }))?.ok).toBe(true);
    expect(api.decideField).toHaveBeenLastCalledWith("tok", TENANT, FIELD, { decision: "confirm" });
    await run({ decision: "reject" });
    expect(api.decideField).toHaveBeenLastCalledWith("tok", TENANT, FIELD, { decision: "reject" });
    await run({ decision: "correct", value: "  2 dozen  " });
    expect(api.decideField).toHaveBeenLastCalledWith("tok", TENANT, FIELD, { decision: "correct", value: "2 dozen" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/enquiries/${ENQ}`);
  });

  it("refuses an unknown decision, an empty or long correction, and a malformed id", async () => {
    expect((await run({ decision: "approve" }))?.error).toMatch(/Choose confirm/);
    expect((await run({ decision: "correct", value: " " }))?.error).toMatch(/Write the corrected value/);
    expect((await run({ decision: "correct", value: "x".repeat(121) }))?.error).toMatch(/too long/);
    expect((await decideFieldAction(TENANT, ENQ, "x", undefined, form({ decision: "confirm" })))?.error).toMatch(/not available/);
    expect(api.decideField).not.toHaveBeenCalled();
  });

  it("explains a value that could not be read without repeating it", async () => {
    api.decideField.mockRejectedValue(new ApiRequestError(422, "value_not_accepted", `${CANARY} could not be read`));
    const r = await run({ decision: "correct", value: CANARY });
    expect(r?.error).toMatch(/could not be read/);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    api.decideField.mockRejectedValue(new ApiRequestError(409, "requirement_not_draft", CANARY));
    expect((await run({ decision: "confirm" }))?.error).toMatch(/no longer a draft/);
  });
});

describe("addFieldAction", () => {
  const run = (values: Record<string, string>) => addFieldAction(TENANT, ENQ, undefined, form(values));

  it("adds a line field with its line and an order field without one", async () => {
    await run({ field: "quantity", line: "2", value: "20", quote: "" });
    expect(api.addField).toHaveBeenLastCalledWith("tok", TENANT, ENQ, { line: 2, field: "quantity", value: "20", quote: null });
    await run({ field: "delivery_city", line: "3", value: "Pune", quote: "Deliver to Pune" });
    expect(api.addField).toHaveBeenLastCalledWith("tok", TENANT, ENQ, { line: null, field: "delivery_city", value: "Pune", quote: "Deliver to Pune" });
  });

  it("validates the field, the line, the value and the quote first", async () => {
    expect((await run({ field: "price", value: "5" }))?.error).toMatch(/Choose a field/);
    expect((await run({ field: "quantity", line: "6", value: "5" }))?.error).toMatch(/line/);
    expect((await run({ field: "quantity", line: "x", value: "5" }))?.error).toMatch(/line/);
    expect((await run({ field: "delivery_city", value: " " }))?.error).toMatch(/Write the value/);
    expect((await run({ field: "delivery_city", value: "Pune", quote: "q".repeat(301) }))?.error).toMatch(/quote is too long/);
    expect(api.addField).not.toHaveBeenCalled();
  });

  it("says when the slot is taken or the quote is not in the text", async () => {
    api.addField.mockRejectedValue(new ApiRequestError(422, "invalid_value", CANARY));
    expect((await run({ field: "delivery_city", value: "Pune" }))?.error).toMatch(/already has a value/);
    api.addField.mockRejectedValue(new ApiRequestError(422, "quote_not_found", CANARY));
    expect((await run({ field: "delivery_city", value: "Pune", quote: "x" }))?.error).toMatch(/not in the enquiry text/);
  });
});

describe("confirm and discard", () => {
  it("call the API with the page's requirement and say nothing was sent", async () => {
    const ok = await confirmRequirementAction(TENANT, ENQ, REQ);
    expect(ok).toEqual({ ok: true, message: "Approved. Nothing was sent to anyone." });
    expect(api.confirmRequirement).toHaveBeenCalledWith("tok", TENANT, REQ);
    expect((await discardRequirementAction(TENANT, ENQ, REQ))?.ok).toBe(true);
    expect(api.discardRequirement).toHaveBeenCalledWith("tok", TENANT, REQ);
  });

  it("explains the refusals", async () => {
    api.confirmRequirement.mockRejectedValue(new ApiRequestError(409, "not_confirmable", CANARY));
    expect((await confirmRequirementAction(TENANT, ENQ, REQ))?.error).toMatch(/saree type and a quantity/);
    expect((await confirmRequirementAction(TENANT, ENQ, "x"))?.error).toMatch(/not available/);
  });
});
