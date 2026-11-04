import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { E1, P1, P2, Q1, S1, T } from "@/lib/api/lead-finder-fixtures";

const h = vi.hoisted(() => ({ tenant: vi.fn(), plan: vi.fn(), approve: vi.fn(), cancel: vi.fn(), act: vi.fn(), practice: vi.fn(), revalidate: vi.fn(), preview: vi.fn(), make: vi.fn(), quote: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.revalidate(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/lead-finder", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/lead-finder")>()),
  planSearch: (...a: unknown[]) => h.plan(...a),
  approveSearch: (...a: unknown[]) => h.approve(...a),
  cancelSearch: (...a: unknown[]) => h.cancel(...a),
  actOnProspects: (...a: unknown[]) => h.act(...a),
  practiceCall: (...a: unknown[]) => h.practice(...a),
  getQuoteDraft: (...a: unknown[]) => h.preview(...a),
  makeQuoteDraft: (...a: unknown[]) => h.make(...a),
}));
vi.mock("@/lib/api/quotes", () => ({ fetchQuote: (...a: unknown[]) => h.quote(...a) }));

import { approveSearchAction, cancelSearchAction, makeQuoteDraftAction, planSearchAction, practiceCallAction, prospectActionsAction, quoteDraftAction } from "./actions";

const as = (role: string) => h.tenant.mockResolvedValue({ id: T, name: "Acme Silks", slug: "acme-silks", role });
const SEARCH = { id: S1, state: "planned" };

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  as("owner");
  h.plan.mockResolvedValue(SEARCH);
  h.approve.mockResolvedValue({ ...SEARCH, state: "done" });
  h.cancel.mockResolvedValue({ ...SEARCH, state: "cancelled" });
  h.act.mockResolvedValue([{ id: P1, ok: true, status: "call_ready", error: null }]);
  h.practice.mockResolvedValue({ simulated: true, outcome: "qualified" });
});

describe("plan a search", () => {
  it("sends the owner's words with the person's token and language; nothing is searched (no approve)", async () => {
    as("sales");
    expect(await planSearchAction(T, "find new retailers in Jayanagar")).toEqual({ ok: true, data: SEARCH });
    expect(h.plan).toHaveBeenCalledWith("tok", T, { text: "find new retailers in Jayanagar", language: "en" });
    expect(h.approve).not.toHaveBeenCalled();
  });
  it("refuses empty or long words, a bad workspace and a Viewer before asking the API", async () => {
    expect(await planSearchAction(T, " a ")).toMatchObject({ ok: false, kind: "invalid", error: "Type what to find and where." });
    expect(await planSearchAction(T, "x".repeat(301))).toMatchObject({ ok: false, kind: "invalid", error: "Keep it under 300 letters." });
    expect(await planSearchAction("bad", "find shops in Eluru")).toMatchObject({ ok: false, kind: "invalid" });
    as("viewer");
    expect(await planSearchAction(T, "find shops in Eluru")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.plan).not.toHaveBeenCalled();
  });
  it("shows the API's sentence for words that are not a search, and plain words for the cap, the switch and a school", async () => {
    h.plan.mockRejectedValueOnce(new ApiRequestError(422, "not_a_search", "Say what to find and where, for example: find new retailers in Jayanagar."));
    expect(await planSearchAction(T, "hello there")).toMatchObject({ ok: false, kind: "invalid", code: "not_a_search", error: "Say what to find and where, for example: find new retailers in Jayanagar." });
    h.plan.mockRejectedValueOnce(new ApiRequestError(429, "search_cap_reached", "x"));
    expect(await planSearchAction(T, "find shops in Eluru")).toMatchObject({ ok: false, kind: "rate_limited", error: "Today's searches are used up. Try again tomorrow, or change the limit in Settings." });
    h.plan.mockRejectedValueOnce(new ApiRequestError(409, "lead_finder_off", "x"));
    expect(await planSearchAction(T, "find shops in Eluru")).toMatchObject({ ok: false, error: "Finding new customers is switched off right now." });
    h.plan.mockRejectedValueOnce(new ApiRequestError(403, "lead_finder_not_available", "x"));
    expect(await planSearchAction(T, "find shops in Eluru")).toMatchObject({ ok: false, kind: "forbidden", error: "Finding new customers is switched off right now." });
  });
  it("a rejected session goes to sign in", async () => {
    h.tenant.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(planSearchAction(T, "find shops in Eluru")).rejects.toThrow("NEXT_REDIRECT:/login");
    h.plan.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(planSearchAction(T, "find shops in Eluru")).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("the OK and Cancel (Owner and Admin)", () => {
  it.each(["owner", "admin"])("%s: the OK runs the search and refreshes the tab", async (role) => {
    as(role);
    expect(await approveSearchAction(T, S1)).toEqual({ ok: true, data: { ...SEARCH, state: "done" } });
    expect(h.approve).toHaveBeenCalledWith("tok", T, S1);
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/retailers`);
    expect(await cancelSearchAction(T, S1)).toMatchObject({ ok: true, data: { state: "cancelled" } });
  });
  it.each(["sales", "viewer"])("%s may not OK or cancel (the API is not asked)", async (role) => {
    as(role);
    expect(await approveSearchAction(T, S1)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(await cancelSearchAction(T, S1)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });
  it("a bad id is refused first; a cancelled search and the cap say so", async () => {
    expect(await approveSearchAction(T, "../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.approve).not.toHaveBeenCalled();
    h.approve.mockRejectedValueOnce(new ApiRequestError(409, "prospect_state", "x"));
    expect(await approveSearchAction(T, S1)).toMatchObject({ ok: false, kind: "conflict", error: "This search was cancelled. Plan it again." });
    h.approve.mockRejectedValueOnce(new ApiRequestError(429, "search_cap_reached", "x"));
    expect(await approveSearchAction(T, S1)).toMatchObject({ ok: false, error: "Today's searches are used up. Try again tomorrow, or change the limit in Settings." });
  });
});

describe("the bulk buttons", () => {
  it("sends the ticked ids (once each) and the action; Sales may", async () => {
    as("sales");
    expect(await prospectActionsAction(T, [P1, P1], "call")).toMatchObject({ ok: true });
    expect(h.act).toHaveBeenCalledWith("tok", T, [P1], "call");
    await prospectActionsAction(T, [P1, P2], "do_not_call");
    expect(h.act).toHaveBeenLastCalledWith("tok", T, [P1, P2], "do_not_call");
  });
  it("refuses a Viewer, no ids, more than 50, a bad id and an unknown action", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const [ids, action] of [[[], "call"], [many, "call"], [["x"], "call"], [[P1], "dial"]] as const) expect(await prospectActionsAction(T, ids as unknown as string[], action as never)).toMatchObject({ ok: false, kind: "invalid" });
    as("viewer");
    expect(await prospectActionsAction(T, [P1], "skip")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.act).not.toHaveBeenCalled();
  });
});

describe("the practice call (simulated; Owner and Admin)", () => {
  it("sends the persona and the language", async () => {
    expect(await practiceCallAction(T, P1, "wants_whatsapp", "te")).toMatchObject({ ok: true, data: { simulated: true } });
    expect(h.practice).toHaveBeenCalledWith("tok", T, P1, "wants_whatsapp", "te");
  });
  it("Sales may not; an unknown persona or language is refused first; a business that is not ready says so", async () => {
    as("sales");
    expect(await practiceCallAction(T, P1, "interested", "en")).toMatchObject({ ok: false, kind: "forbidden" });
    as("owner");
    expect(await practiceCallAction(T, P1, "angry" as never, "en")).toMatchObject({ ok: false, kind: "invalid" });
    expect(await practiceCallAction(T, P1, "interested", "hi" as never)).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.practice).not.toHaveBeenCalled();
    h.practice.mockRejectedValueOnce(new ApiRequestError(409, "prospect_state", "x"));
    expect(await practiceCallAction(T, P1, "interested", "en")).toMatchObject({ ok: false, error: "Only a business marked Ready to call can have a practice call." });
  });
});

describe("the draft quote of a qualified call", () => {
  const PREVIEW = { prospectId: P1, leadId: P2, ready: true, made: false, quoteId: Q1, lines: [], leftOut: [] };
  it("the preview is for the Owner, Admin and Sales; nothing is looked up before the draft is made", async () => {
    as("sales");
    h.preview.mockResolvedValue(PREVIEW);
    expect(await quoteDraftAction(T, P1)).toEqual({ ok: true, data: { ...PREVIEW, enquiryId: null } });
    expect(h.preview).toHaveBeenCalledWith("tok", T, P1);
    expect(h.quote).not.toHaveBeenCalled();
    as("viewer");
    expect(await quoteDraftAction(T, P1)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(await quoteDraftAction(T, "nope")).toMatchObject({ ok: false });
  });
  it("once made, the draft's enquiry is looked up for the link; a lookup that fails leaves it null; a call that did not qualify says so", async () => {
    h.preview.mockResolvedValue({ ...PREVIEW, made: true });
    h.quote.mockResolvedValueOnce({ id: Q1, enquiry_id: E1 });
    expect(await quoteDraftAction(T, P1)).toMatchObject({ ok: true, data: { made: true, enquiryId: E1 } });
    expect(h.quote).toHaveBeenCalledWith("tok", T, Q1);
    h.quote.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await quoteDraftAction(T, P1)).toMatchObject({ ok: true, data: { enquiryId: null } });
    h.quote.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(quoteDraftAction(T, P1)).rejects.toThrow("NEXT_REDIRECT:/login");
    h.preview.mockRejectedValueOnce(new ApiRequestError(409, "not_qualified", "x"));
    expect(await quoteDraftAction(T, P1)).toMatchObject({ ok: false, error: "Only a call that qualified has a draft quote." });
  });
  it("making it is the Owner's or an Admin's: a NEW customer, no delivery state; nothing is approved or sent", async () => {
    h.make.mockResolvedValue({ quoteId: Q1, enquiryId: E1, status: "draft" });
    as("admin");
    expect(await makeQuoteDraftAction(T, P1)).toEqual({ ok: true, data: { quoteId: Q1, enquiryId: E1, status: "draft" } });
    expect(h.make).toHaveBeenCalledWith("tok", T, P1, { customerKind: "new", deliveryState: null });
    h.make.mockClear();
    as("sales");
    expect(await makeQuoteDraftAction(T, P1)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.make).not.toHaveBeenCalled();
  });
  it("the second factor shows the way to Security; nothing to quote and a draft made before say so in plain words", async () => {
    h.make.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await makeQuoteDraftAction(T, P1)).toMatchObject({ ok: false, kind: "mfa", mfa: true });
    h.make.mockRejectedValueOnce(new ApiRequestError(422, "nothing_to_quote", "x"));
    expect(await makeQuoteDraftAction(T, P1)).toMatchObject({ ok: false, code: "nothing_to_quote", error: "Nothing from this call can go in a draft: no item has both an exact price and a number." });
    h.make.mockRejectedValueOnce(new ApiRequestError(409, "quote_draft_exists", "x"));
    expect(await makeQuoteDraftAction(T, P1)).toMatchObject({ ok: false, code: "quote_draft_exists", error: "A draft from this call was already made with other prices. Open it instead." });
  });
});
