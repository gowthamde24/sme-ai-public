import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { DRAFT, HASH, LEAD, QUESTION, REQ, TENANT, TOUCH } from "@/lib/api/followups-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const api = vi.hoisted(() => ({
  recordTouch: vi.fn(),
  createDraft: vi.fn(),
  approveDraft: vi.fn(),
  discardDraft: vi.fn(),
  recordSent: vi.fn(),
  createPolicyVersion: vi.fn(),
  syncQuestionDrafts: vi.fn(),
  approveQuestionDraft: vi.fn(),
  discardQuestionDraft: vi.fn(),
}));
const revalidatePath = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/followups", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/followups")>();
  return Object.fromEntries(Object.entries(original).map(([k, v]) => [k, k in api ? (...a: unknown[]) => api[k as keyof typeof api](...a) : v]));
});

import {
  approveDraftAction,
  createDraftAction,
  createPolicyAction,
  decideQuestionAction,
  discardDraftAction,
  recordSentAction,
  recordTouchAction,
  syncQuestionsAction,
} from "./followup-actions";

const CANARY = "CANARY-77c1d0";
const POLICY = "99999999-9999-4999-8999-999999999991";

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  return data;
}
const touch = (v: Record<string, string> = {}) => recordTouchAction(TENANT, LEAD, undefined, form({ touch_id: TOUCH, direction: "out", channel: "email", happened_at: "", ...v }));
const policyValues = { policy_id: POLICY, effective_from: "2026-10-08", gap_days: "3, 7", max_touches: "3", quiet_start: "21:00", quiet_end: "09:00", holidays: "", min_gap_hours: "24", offset_minutes: "330", weekday: ["0", "1", "2"] };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  api.recordTouch.mockResolvedValue({ touch_id: TOUCH });
  api.createDraft.mockResolvedValue({ draft_id: DRAFT, touch_number: 2 });
  api.approveDraft.mockResolvedValue({});
  api.discardDraft.mockResolvedValue({});
  api.recordSent.mockResolvedValue({});
  api.createPolicyVersion.mockResolvedValue({});
  api.syncQuestionDrafts.mockResolvedValue({ changed: 1 });
  api.approveQuestionDraft.mockResolvedValue({});
  api.discardQuestionDraft.mockResolvedValue({});
});

describe("every action authenticates first and refuses malformed ids before the API is called", () => {
  it("a rejected session never reaches the API", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => touch())).toBe("/login");
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it("malformed tenant, lead, draft, requirement and draft ids", async () => {
    const f = form({ touch_id: TOUCH, draft_id: TOUCH, state_hash: HASH, channel: "email", direction: "out" });
    expect((await recordTouchAction("x", LEAD, undefined, f))?.ok).toBe(false);
    expect((await recordTouchAction(TENANT, "x", undefined, f))?.ok).toBe(false);
    expect((await createDraftAction("x", LEAD, undefined, f))?.ok).toBe(false);
    expect((await approveDraftAction(TENANT, LEAD, "x", undefined, f))?.ok).toBe(false);
    expect((await discardDraftAction(TENANT, "x", DRAFT))?.ok).toBe(false);
    expect((await recordSentAction(TENANT, LEAD, "x", undefined, f))?.ok).toBe(false);
    expect((await createPolicyAction("x", undefined, f))?.ok).toBe(false);
    expect((await syncQuestionsAction(TENANT, "x"))?.ok).toBe(false);
    expect((await decideQuestionAction(TENANT, REQ, "x", "approve"))?.ok).toBe(false);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("recordTouchAction: a person's word, never wording, a contact or a status", () => {
  it("an empty time sends no time at all: the database stamps now", async () => {
    const r = await touch();
    expect(r).toEqual({ ok: true, message: "Recorded: you sent it yourself. Nothing was sent by this system." });
    expect(api.recordTouch).toHaveBeenCalledWith("tok", TENANT, LEAD, { id: TOUCH, direction: "out", channel: "email" });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/leads/${LEAD}/followup`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/followups`);
  });

  it("a typed time is sent as an instant; a future time never reaches the API", async () => {
    await touch({ happened_at: "2026-10-05T10:30" });
    expect(api.recordTouch).toHaveBeenCalledWith("tok", TENANT, LEAD, { id: TOUCH, direction: "out", channel: "email", occurredAt: "2026-10-05T05:00:00.000Z" });
    api.recordTouch.mockClear();
    expect((await touch({ happened_at: "2099-01-01T10:30" }))?.error).toBe("A touch cannot be in the future. Leave the time empty for now.");
    expect(api.recordTouch).not.toHaveBeenCalled();
  });

  it("an inbound reply has its own message; a made-up direction or channel is refused", async () => {
    expect((await touch({ direction: "in" }))?.message).toBe("Recorded: they replied.");
    expect((await touch({ direction: "sideways" }))?.ok).toBe(false);
    expect((await touch({ channel: "pigeon" }))?.ok).toBe(false);
    expect((await touch({ touch_id: "x" }))?.error).toBe("This form is out of date. Reload the page and try again.");
  });

  it("extra fields in the form (wording, a contact, a tenant, a status) are never forwarded", async () => {
    await touch({ body: "hello", contact_id: "c", tenant_id: "t", status: "approved", phone: "123" });
    const body = api.recordTouch.mock.calls[0][3];
    expect(Object.keys(body).sort()).toEqual(["channel", "direction", "id"]);
  });
});

describe("createDraftAction: the channel only", () => {
  it("sends the id and the channel; the message says a person sends it outside the system", async () => {
    const r = await createDraftAction(TENANT, LEAD, undefined, form({ draft_id: DRAFT, channel: "whatsapp", body: "my own words", status: "approved" }));
    expect(api.createDraft).toHaveBeenCalledWith("tok", TENANT, LEAD, { id: DRAFT, channel: "whatsapp" });
    expect(r?.message).toBe("A draft for touch 2 was made. Read it, approve it, then send it yourself outside this system.");
  });

  it("a channel outside the list is refused", async () => {
    expect((await createDraftAction(TENANT, LEAD, undefined, form({ draft_id: DRAFT, channel: "sms" })))?.ok).toBe(false);
    expect(api.createDraft).not.toHaveBeenCalled();
  });
});

describe("approveDraftAction: the fingerprint of the draft that was shown", () => {
  it("sends exactly the state_hash the form carried", async () => {
    const reviewed = "0123456789abcdef".repeat(4); // not an easy value: a constant would not pass
    const r = await approveDraftAction(TENANT, LEAD, DRAFT, undefined, form({ state_hash: reviewed }));
    expect(api.approveDraft).toHaveBeenCalledWith("tok", TENANT, DRAFT, reviewed);
    expect(r?.ok).toBe(true);
    expect(r?.message).toMatch(/send it yourself/);
  });

  it("a missing or malformed fingerprint is stale, so the page is read again, and nothing is approved", async () => {
    for (const hash of ["", "zz", "A".repeat(64), HASH.slice(1)]) {
      expect(await approveDraftAction(TENANT, LEAD, DRAFT, undefined, form({ state_hash: hash }))).toEqual({ ok: false, error: "This form is out of date. Reload the page and try again.", stale: true });
    }
    expect(api.approveDraft).not.toHaveBeenCalled();
  });

  it("a refusal because the draft moved is stale and refreshes the page's cache", async () => {
    api.approveDraft.mockRejectedValue(new ApiRequestError(409, "followup_mismatch", CANARY));
    const r = await approveDraftAction(TENANT, LEAD, DRAFT, undefined, form({ state_hash: HASH }));
    expect(r?.stale).toBe(true);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/leads/${LEAD}/followup`);
  });

  it("without the second factor the sentence points to the Security page and the page is not stale", async () => {
    api.approveDraft.mockRejectedValue(new ApiRequestError(403, "mfa_required", CANARY));
    const r = await approveDraftAction(TENANT, LEAD, DRAFT, undefined, form({ state_hash: HASH }));
    expect(r?.error).toMatch(/authenticator app/);
    expect(r?.stale).toBe(false);
  });
});

describe("discard and 'I sent it myself'", () => {
  it("discard sends nothing but the ids", async () => {
    expect(await discardDraftAction(TENANT, LEAD, DRAFT)).toEqual({ ok: true, message: "Discarded." });
    expect(api.discardDraft).toHaveBeenCalledWith("tok", TENANT, DRAFT);
  });

  it("recorded as sent: touch id, empty time = now (no time sent), typed time as an instant, future refused", async () => {
    const send = (v: Record<string, string>) => recordSentAction(TENANT, LEAD, DRAFT, undefined, form({ touch_id: TOUCH, ...v }));
    expect((await send({ happened_at: "" }))?.message).toBe("Recorded: you sent it yourself. Nothing was sent by this system.");
    expect(api.recordSent).toHaveBeenLastCalledWith("tok", TENANT, DRAFT, { touchId: TOUCH });
    await send({ happened_at: "2026-10-05T10:30" });
    expect(api.recordSent).toHaveBeenLastCalledWith("tok", TENANT, DRAFT, { touchId: TOUCH, occurredAt: "2026-10-05T05:00:00.000Z" });
    api.recordSent.mockClear();
    expect((await send({ happened_at: "2099-01-01T10:30" }))?.ok).toBe(false);
    expect((await send({ touch_id: "x" }))?.ok).toBe(false);
    expect(api.recordSent).not.toHaveBeenCalled();
  });
});

describe("policy and question actions", () => {
  it("a policy is sent typed; the database checks it again", async () => {
    const r = await createPolicyAction(TENANT, undefined, form(policyValues));
    expect(r).toEqual({ ok: true, message: "The policy is published. It applies from the day you chose." });
    expect(api.createPolicyVersion.mock.calls[0][2]).toMatchObject({ id: POLICY, gapDays: [3, 7], maxTouches: 3, allowedWeekdays: [0, 1, 2] });
  });

  it("a policy that is wrong in the form never reaches the API", async () => {
    expect((await createPolicyAction(TENANT, undefined, form({ ...policyValues, gap_days: "3" })))?.ok).toBe(false);
    expect((await createPolicyAction(TENANT, undefined, form({ ...policyValues, policy_id: "x" })))?.ok).toBe(false);
    expect(api.createPolicyVersion).not.toHaveBeenCalled();
  });

  it("sync, approve and discard of a question draft", async () => {
    expect((await syncQuestionsAction(TENANT, REQ))?.message).toBe("The questions were updated from the requirement.");
    api.syncQuestionDrafts.mockResolvedValue({ changed: 0 });
    expect((await syncQuestionsAction(TENANT, REQ))?.message).toBe("The questions are up to date.");
    expect((await decideQuestionAction(TENANT, REQ, QUESTION, "approve"))?.message).toBe("Approved. Copy it and ask the customer yourself.");
    expect(api.approveQuestionDraft).toHaveBeenCalledWith("tok", TENANT, QUESTION);
    expect((await decideQuestionAction(TENANT, REQ, QUESTION, "discard"))?.message).toBe("Discarded.");
    expect(api.discardQuestionDraft).toHaveBeenCalledWith("tok", TENANT, QUESTION);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${TENANT}/requirements/${REQ}/questions`);
  });
});

describe("failures are our own words, never the server's, and an erased key reads as a key", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["recordTouch", () => touch()],
    ["createDraft", () => createDraftAction(TENANT, LEAD, undefined, form({ draft_id: DRAFT, channel: "email" }))],
    ["discardDraft", () => discardDraftAction(TENANT, LEAD, DRAFT)],
    ["recordSent", () => recordSentAction(TENANT, LEAD, DRAFT, undefined, form({ touch_id: TOUCH }))],
    ["createPolicyVersion", () => createPolicyAction(TENANT, undefined, form(policyValues))],
    ["syncQuestionDrafts", () => syncQuestionsAction(TENANT, REQ)],
    ["approveQuestionDraft", () => decideQuestionAction(TENANT, REQ, QUESTION, "approve")],
  ];

  it.each(calls)("%s", async (name, run) => {
    api[name as keyof typeof api].mockRejectedValue(new ApiRequestError(409, "contact_blocked", CANARY, "erased_key"));
    const r = (await run()) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^[A-Z].*[.]$/);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(JSON.stringify(r)).not.toMatch(/erased[\s_-]*key/i);
    api[name as keyof typeof api].mockRejectedValue(new Error(CANARY));
    expect(((await run()) as { error: string }).error).toBe("Could not save. Try again.");
    api[name as keyof typeof api].mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => run())).toBe("/login");
  });
});
