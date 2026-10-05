import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import {
  addField,
  captureEnquiry,
  confirmRequirement,
  decideField,
  discardRequirement,
  fetchEnquiry,
  fetchLeadEnquiries,
  fetchRequirement,
  parseCaptured,
  parseEnquiry,
  parseRequirementView,
  startRequirementRun,
} from "./enquiries";

const TENANT = "22222222-2222-2222-2222-222222222222";
const LEAD = "33333333-3333-3333-3333-333333333333";
const ENQ = "44444444-4444-4444-4444-444444444444";
const FIELD = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";

const ENQUIRY = {
  id: ENQ, lead_id: LEAD, company_id: null, contact_id: null, channel: "whatsapp", received_at: "2026-10-05T10:00:00+00:00",
  subject: null, body: "Need 20 sarees", truncated_from: null, created_by: null, created_at: "2026-10-05T10:01:00+00:00", archived_at: null,
};
const FIELD_JSON = {
  id: FIELD, line_no: 1, field_key: "quantity", value: { code: null, int_value: 20, date_value: null, text: null, basis: "piece" }, display: "20 pieces",
  certainty: "stated", state: "proposed", conflict: false, created_via: "agent", quote: "20 sarees", quote_start: 5, quote_end: 14, decided_by: null, decided_at: null,
};
const VIEW = {
  requirement: { id: REQ, status: "draft", created_via: "agent", agent_run_id: null, confirmed_by: null, confirmed_at: null, created_at: "2026-10-05T10:05:00+00:00" },
  fields: [FIELD_JSON], lines: [1], confirmable: false, ready_for_quote: false,
  flags: [{ kind: "missing", field_key: "delivery_city", line_no: null }],
  questions: [{ code: "missing_delivery_city", text: "Which city should we deliver to?", field_key: "delivery_city", line_no: null }],
};

function respond(body: unknown, status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
}

describe("enquiries API client", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("parses an enquiry and refuses one that does not match the contract", () => {
    expect(parseEnquiry(ENQUIRY).channel).toBe("whatsapp");
    for (const broken of [{ ...ENQUIRY, channel: "fax" }, { ...ENQUIRY, body: 5 }, { ...ENQUIRY, truncated_from: "6001" }, { ...ENQUIRY, id: undefined }, "text", null])
      expect(() => parseEnquiry(broken)).toThrow(ApiContractError);
    expect(() => parseCaptured({ enquiry: ENQUIRY, text_changed: "yes", truncated: false })).toThrow(ApiContractError);
    expect(parseCaptured({ enquiry: ENQUIRY, text_changed: true, truncated: false }).text_changed).toBe(true);
  });

  it("parses a requirement view strictly (a state, a certainty, a field key or a flag outside the contract is an error)", () => {
    expect(parseRequirementView(VIEW).fields[0].display).toBe("20 pieces");
    expect(parseRequirementView({ ...VIEW, requirement: null }).requirement).toBeNull();
    const field = (over: object) => ({ ...VIEW, fields: [{ ...FIELD_JSON, ...over }] });
    for (const broken of [
      field({ state: "approved" }), field({ certainty: "sure" }), field({ field_key: "price" }), field({ conflict: "no" }), field({ created_via: "robot" }),
      field({ value: { code: null } }), { ...VIEW, confirmable: 1 }, { ...VIEW, flags: [{ kind: "odd", field_key: "quantity", line_no: null }] },
      { ...VIEW, questions: [{ code: "x", text: 5, field_key: "quantity", line_no: null }] }, { ...VIEW, lines: ["1"] },
    ])
      expect(() => parseRequirementView(broken)).toThrow(ApiContractError);
  });

  it("captures an enquiry with the caller's id and an exact instant, and sends nothing else", async () => {
    const f = respond({ enquiry: ENQUIRY, text_changed: false, truncated: false }, 201);
    globalThis.fetch = f as unknown as typeof fetch;
    await captureEnquiry("tok", TENANT, LEAD, { id: ENQ, channel: "email", receivedAt: "2026-10-05T10:00:00.000Z", subject: null, text: "Need 20 sarees" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`http://api.test/v1/tenants/${TENANT}/leads/${LEAD}/enquiries`);
    expect(JSON.parse(String(init?.body))).toEqual({ id: ENQ, channel: "email", received_at: "2026-10-05T10:00:00.000Z", text: "Need 20 sarees" });
    await captureEnquiry("tok", TENANT, LEAD, { id: ENQ, channel: "email", receivedAt: "2026-10-05T10:00:00.000Z", subject: "Re: order", text: "x" });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).subject).toBe("Re: order");
  });

  it("reads the lead's enquiries, one enquiry and its requirement", async () => {
    globalThis.fetch = respond([ENQUIRY]) as unknown as typeof fetch;
    expect(await fetchLeadEnquiries("tok", TENANT, LEAD)).toHaveLength(1);
    globalThis.fetch = respond(ENQUIRY) as unknown as typeof fetch;
    expect((await fetchEnquiry("tok", TENANT, ENQ)).id).toBe(ENQ);
    const f = respond(VIEW);
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await fetchRequirement("tok", TENANT, ENQ)).flags).toHaveLength(1);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/enquiries/${ENQ}/requirement`);
    globalThis.fetch = respond({ not: "a list" }) as unknown as typeof fetch;
    await expect(fetchLeadEnquiries("tok", TENANT, LEAD)).rejects.toThrow(ApiContractError);
  });

  it("decides, adds, confirms and discards through the right endpoints", async () => {
    let f = respond({ field_id: FIELD, state: "corrected", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await decideField("tok", TENANT, FIELD, { decision: "correct", value: "2 dozen" });
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/requirement-fields/${FIELD}/decision`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ decision: "correct", value: "2 dozen" });
    f = respond({ field_id: FIELD, requirement_id: REQ, replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await addField("tok", TENANT, ENQ, { line: null, field: "delivery_city", value: "Pune", quote: null });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ field: "delivery_city", value: "Pune" });
    await addField("tok", TENANT, ENQ, { line: 2, field: "quantity", value: "5", quote: "5 sarees" });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual({ line: 2, field: "quantity", value: "5", quote: "5 sarees" });
    f = respond({ requirement_id: REQ, status: "confirmed", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await confirmRequirement("tok", TENANT, REQ);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/requirements/${REQ}/confirm`);
    f = respond({ requirement_id: REQ, status: "discarded", replayed: false });
    globalThis.fetch = f as unknown as typeof fetch;
    await discardRequirement("tok", TENANT, REQ);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/requirements/${REQ}/discard`);
  });

  it("starts a requirement run on an enquiry", async () => {
    const f = respond({ id: ENQ }, 202);
    globalThis.fetch = f as unknown as typeof fetch;
    await startRequirementRun("tok", TENANT, { id: REQ, enquiryId: ENQ }).catch(() => undefined); // the run body is checked by parseRun elsewhere
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ id: REQ, agent: "requirement", target_kind: "enquiry", target_id: ENQ });
  });

  it("never lets a malformed id reach the API", async () => {
    const f = respond({});
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(fetchEnquiry("tok", "../me", ENQ)).rejects.toThrow(ApiContractError);
    await expect(fetchRequirement("tok", TENANT, "x")).rejects.toThrow(ApiContractError);
    await expect(decideField("tok", TENANT, "x", { decision: "confirm" })).rejects.toThrow(ApiContractError);
    await expect(confirmRequirement("tok", TENANT, "../x")).rejects.toThrow(ApiContractError);
    await expect(captureEnquiry("tok", TENANT, LEAD, { id: "x", channel: "email", receivedAt: "t", subject: null, text: "x" })).rejects.toThrow(ApiContractError);
    expect(f).not.toHaveBeenCalled();
  });
});
