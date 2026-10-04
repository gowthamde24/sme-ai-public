import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import {
  cancelErasure,
  confirmationPhrase,
  fetchErasureRequest,
  phraseMatches,
  executeErasure,
  fetchErasureRequests,
  parseRequest,
  parseResult,
  requestErasure,
} from "./erasure";

const TENANT = "22222222-2222-2222-2222-222222222222";
const REQ = "44444444-4444-4444-4444-444444444444";
const CONTACT = "33333333-3333-3333-3333-333333333333";
const ME = "55555555-5555-4555-8555-555555555555";

const RESULT_JSON = {
  request_id: REQ,
  scope: "contact",
  status: "executed",
  dry_run: false,
  counts: { "contacts.full_name": 1, "contacts.email": 1 },
  review: [{ table: "evidence", column: "snippet", id: CONTACT }],
  review_truncated: false,
  exports_logged: 2,
  note: "Names are matched only when a whole field equals the name.",
  replayed: false,
};
const REQUEST_JSON = {
  id: REQ,
  scope: "contact",
  subject_id: CONTACT,
  status: "pending",
  requested_by: ME,
  created_at: "2026-10-05T12:00:00+00:00",
  execute_after: "2026-10-05T12:00:00+00:00",
  executed_by: null,
  executed_at: null,
  cancelled_by: null,
  cancelled_at: null,
  result: null,
};

const CONTACT_ROW = {
  id: CONTACT,
  company_id: null,
  full_name: "x",
  email: null,
  phone: null,
  job_title: null,
  email_consent: "unknown",
  whatsapp_consent: "unknown",
  phone_consent: "unknown",
  suppressed_at: null,
  suppression_reason: null,
  created_at: "2026-10-05T12:00:00+00:00",
  updated_at: "2026-10-05T12:00:00+00:00",
  archived_at: null,
  created_via: "manual",
  created_by: null,
};
const COMPANY_ROW = {
  id: CONTACT,
  name: "x",
  type: "prospect",
  website: null,
  country: null,
  region: null,
  city: null,
  industry: null,
  tags: [],
  created_at: "2026-10-05T12:00:00+00:00",
  updated_at: "2026-10-05T12:00:00+00:00",
  archived_at: null,
  created_via: "manual",
  created_by: null,
};

function respond(body: unknown, status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("erasure API client", () => {
  const original = globalThis.fetch;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
  });
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  it("parses a result and refuses one that does not match the contract", () => {
    expect(parseResult(RESULT_JSON).counts["contacts.email"]).toBe(1);
    for (const broken of [
      { ...RESULT_JSON, status: "done" },
      { ...RESULT_JSON, scope: "everyone" },
      { ...RESULT_JSON, counts: { "contacts.email": "1" } },
      { ...RESULT_JSON, counts: [] },
      { ...RESULT_JSON, review: [{ table: "evidence" }] },
      { ...RESULT_JSON, exports_logged: "2" },
      { ...RESULT_JSON, note: 5 },
      "text",
      null,
    ])
      expect(() => parseResult(broken)).toThrow(ApiContractError);
  });

  it("parses a request, with or without a result, and refuses an unknown status", () => {
    expect(parseRequest(REQUEST_JSON).result).toBeNull();
    expect(
      parseRequest({ ...REQUEST_JSON, status: "executed", result: RESULT_JSON })
        .result?.exports_logged,
    ).toBe(2);
    for (const broken of [
      { ...REQUEST_JSON, status: "done" },
      { ...REQUEST_JSON, subject_id: 5 },
      { ...REQUEST_JSON, id: undefined },
      { ...REQUEST_JSON, result: "x" },
    ])
      expect(() => parseRequest(broken)).toThrow(ApiContractError);
  });

  it("lists with the user's token", async () => {
    const f = respond({ items: [REQUEST_JSON], next_cursor: null });
    globalThis.fetch = f as unknown as typeof fetch;
    const page = await fetchErasureRequests("tok", TENANT);
    expect(page.items).toHaveLength(1);
    expect(f.mock.calls[0][0]).toBe(
      `http://api.test/v1/tenants/${TENANT}/erasure-requests?limit=20`,
    );
    expect(
      (f.mock.calls[0][1]?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer tok");
  });

  it("requests with the caller's id; a workspace request carries no subject", async () => {
    const f = respond(REQUEST_JSON, 201);
    globalThis.fetch = f as unknown as typeof fetch;
    await requestErasure("tok", TENANT, {
      id: REQ,
      scope: "contact",
      subjectId: CONTACT,
    });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
      id: REQ,
      scope: "contact",
      subject_id: CONTACT,
    });
    await requestErasure("tok", TENANT, {
      id: REQ,
      scope: "tenant",
      subjectId: null,
    });
    expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual({
      id: REQ,
      scope: "tenant",
    });
  });

  it("refuses a mismatched scope and subject before calling the API", async () => {
    const f = respond(REQUEST_JSON);
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(
      requestErasure("tok", TENANT, {
        id: REQ,
        scope: "tenant",
        subjectId: CONTACT,
      }),
    ).rejects.toThrow(ApiContractError);
    await expect(
      requestErasure("tok", TENANT, {
        id: REQ,
        scope: "contact",
        subjectId: null,
      }),
    ).rejects.toThrow(ApiContractError);
    await expect(
      requestErasure("tok", "nope", {
        id: REQ,
        scope: "tenant",
        subjectId: null,
      }),
    ).rejects.toThrow(ApiContractError);
    expect(f).not.toHaveBeenCalled();
  });

  it("previews and executes by the same endpoint, and cancels", async () => {
    const f = respond({ ...RESULT_JSON, dry_run: true, status: "dry_run" });
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await executeErasure("tok", TENANT, REQ, true)).dry_run).toBe(true);
    expect(f.mock.calls[0][0]).toBe(
      `http://api.test/v1/tenants/${TENANT}/erasure-requests/${REQ}/execute`,
    );
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
      dry_run: true,
    });
    const g = respond({ ...REQUEST_JSON, status: "cancelled" });
    globalThis.fetch = g as unknown as typeof fetch;
    expect((await cancelErasure("tok", TENANT, REQ)).status).toBe("cancelled");
    expect(g.mock.calls[0][0]).toBe(
      `http://api.test/v1/tenants/${TENANT}/erasure-requests/${REQ}/cancel`,
    );
    await expect(executeErasure("tok", TENANT, "x", false)).rejects.toThrow(
      ApiContractError,
    );
  });

  it("reads one request", async () => {
    const f = respond(REQUEST_JSON);
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await fetchErasureRequest("tok", TENANT, REQ)).id).toBe(REQ);
    expect(f.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/erasure-requests/${REQ}`);
  });

  it("builds the confirmation words from the subject's name, or the workspace slug", async () => {
    const contact = respond({ ...CONTACT_ROW, full_name: "  Asha   Rao " });
    globalThis.fetch = contact as unknown as typeof fetch;
    expect(await confirmationPhrase("tok", TENANT, { scope: "contact", subject_id: CONTACT })).toBe("ERASE Asha Rao");
    expect(contact.mock.calls[0][0]).toBe(`http://api.test/v1/tenants/${TENANT}/contacts/${CONTACT}`);
    const company = respond({ ...COMPANY_ROW, name: "Acme Silks" });
    globalThis.fetch = company as unknown as typeof fetch;
    expect(await confirmationPhrase("tok", TENANT, { scope: "company", subject_id: CONTACT })).toBe("ERASE Acme Silks");
    const tenant = respond({ id: TENANT, name: "Acme", slug: "acme-co", role: "owner" });
    globalThis.fetch = tenant as unknown as typeof fetch;
    expect(await confirmationPhrase("tok", TENANT, { scope: "tenant", subject_id: null })).toBe("ERASE acme-co");
    await expect(confirmationPhrase("tok", TENANT, { scope: "contact", subject_id: null })).rejects.toThrow(ApiContractError);
  });

  it("matches typed words ignoring spacing but not case", () => {
    expect(phraseMatches(" ERASE   Asha Rao", "ERASE Asha Rao")).toBe(true);
    for (const wrong of ["erase Asha Rao", "ERASE asha rao", "ERASE Asha", "", "ERASE Asha Rao!"])
      expect(phraseMatches(wrong, "ERASE Asha Rao")).toBe(false);
  });
});
