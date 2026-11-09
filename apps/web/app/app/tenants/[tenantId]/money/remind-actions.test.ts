import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), tenant: vi.fn(), statement: vi.fn(), put: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => h.user() }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/ledger", async (orig) => ({ ...(await orig<typeof import("@/lib/api/ledger")>()), getLedgerStatement: (...a: unknown[]) => h.statement(...a) }));
vi.mock("@/lib/api/campaigns", async (orig) => ({ ...(await orig<typeof import("@/lib/api/campaigns")>()), putCampaign: (...a: unknown[]) => h.put(...a), addRecipients: (...a: unknown[]) => h.add(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseStatement } from "@/lib/api/ledger";
import { STATEMENT_JSON } from "@/lib/api/ledger-fixtures";

import { remindAction } from "./remind-actions";
import { reminderText } from "./remind-text";

/** app v4 part 6: Remind makes a DRAFT payment reminder for one customer (C1's flow) and sends nothing. */
const T = "66666666-6666-4666-8666-666666666666";
const CAMP = "ca000000-0000-4000-8000-0000000000c1";
const CO = "11111111-1111-4111-8111-111111111111";
const CT = "ca000000-0000-4000-8000-0000000000f1";
beforeEach(() => {
  vi.stubEnv("APP_V4", "1");
  h.user.mockReset().mockResolvedValue({ accessToken: "tok" });
  h.tenant.mockReset().mockResolvedValue({ role: "owner", name: "Sri Visual Hardware" });
  h.statement.mockReset().mockResolvedValue(parseStatement(STATEMENT_JSON));
  h.put.mockReset().mockResolvedValue({ campaign: {}, created: true, back_to_draft: false });
  h.add.mockReset().mockResolvedValue({ added: 1, skipped: [], recipients: 1 });
});

describe("Remind", () => {
  it("makes a payment_due campaign DRAFT with one recipient: the oldest overdue claim, what is overdue; fixed words; the campaign id is the screen's", async () => {
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "Sri Rama Builders" })).toEqual({ ok: true, campaignId: CAMP, added: 1 });
    expect(h.statement).toHaveBeenCalledWith("tok", T, { company_id: CO });
    const [, , id, body] = h.put.mock.calls[0];
    expect(id).toBe(CAMP);
    expect(body).toMatchObject({ name: "Reminder: Sri Rama Builders", kind: "payment_due", language: "en", waTemplateId: null, steps: [{ offset_days: 0, time: "10:00" }], callAfterStep: null });
    expect(body.messageText).toBe(reminderText("Sri Visual Hardware", 5_000_000, "2026-10-05"));
    expect(body.messageText).toContain("₹50,000");
    expect(h.add).toHaveBeenCalledWith("tok", T, CAMP, [{ contact_id: CT, due_date: "2026-10-05", amount_paise: 5_000_000, reference: "INV-1001" }]);
  });
  it("a customer with nothing overdue is reminded of what is open (the oldest claim); one with nothing open gets no draft", async () => {
    const open = parseStatement({ ...STATEMENT_JSON, open_invoices: STATEMENT_JSON.open_invoices.map((i) => ({ ...i, overdue_days: 0 })) });
    h.statement.mockResolvedValue(open);
    await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" });
    expect(h.add.mock.calls[0][3][0]).toMatchObject({ due_date: "2026-10-05", amount_paise: 13_000_000 });
    h.put.mockClear();
    h.statement.mockResolvedValue(parseStatement({ ...STATEMENT_JSON, open_invoices: [] }));
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "nothing_due" });
    expect(h.put).not.toHaveBeenCalled();
  });
  it("no contact: nothing is asked and nothing is made; a person's own account is asked by its contact", async () => {
    h.statement.mockClear();
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: null, name: "A" })).toEqual({ ok: false, error: "no_contact" });
    expect(h.statement).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    await remindAction(T, CAMP, { companyId: null, contactId: CT, name: "A" });
    expect(h.statement).toHaveBeenCalledWith("tok", T, { contact_id: CT });
  });
  it("Owner, Admin and Sales; not a Viewer; bad ids, no name or a server without app v4 are refused before anything is asked", async () => {
    h.tenant.mockResolvedValue({ role: "viewer", name: "X" });
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "forbidden" });
    for (const role of ["sales", "admin"]) {
      h.tenant.mockResolvedValue({ role, name: "X" });
      expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toMatchObject({ ok: true });
    }
    h.statement.mockClear();
    expect(await remindAction("x", CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "invalid" });
    expect(await remindAction(T, "../x", { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "invalid" });
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "  " })).toEqual({ ok: false, error: "invalid" });
    expect(await remindAction(T, CAMP, { companyId: "nope", contactId: CT, name: "A" })).toEqual({ ok: false, error: "invalid" });
    vi.stubEnv("APP_V4", "");
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "not_available" });
    expect(h.statement).not.toHaveBeenCalled();
  });
  it("said in closed words: nobody could be added, the API's refusals; a lapsed sign-in goes to sign in", async () => {
    h.add.mockResolvedValueOnce({ added: 0, skipped: [{ row: 1, reason: "no_consent" }], recipients: 0 });
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "not_added" });
    h.put.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "invalid" });
    h.put.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "forbidden" });
    h.put.mockRejectedValueOnce(new ApiRequestError(503, "down", "x"));
    expect(await remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).toEqual({ ok: false, error: "down" });
    h.statement.mockRejectedValueOnce(new ApiAuthError("out"));
    await expect(remindAction(T, CAMP, { companyId: CO, contactId: CT, name: "A" })).rejects.toThrow("redirect:/login");
  });
});
