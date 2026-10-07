import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseDueItem, parseLeadFollowup, parsePolicyVersion, parseQuestionDraft } from "@/lib/api/followups";
import { DRAFT, DRAFT_JSON, DUE_JSON, FOLLOWUP_JSON, GATE_JSON, HASH, LEAD, OTHER_PERSON, PERSON, POLICY_JSON, QUESTION_JSON, REQ, TENANT } from "@/lib/api/followups-fixtures";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const api = vi.hoisted(() => ({ fetchLeadFollowup: vi.fn(), fetchDueList: vi.fn(), fetchPolicyVersions: vi.fn(), fetchQuestionDrafts: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/followups", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/followups")>();
  return { ...original, ...Object.fromEntries(Object.keys(api).map((k) => [k, (...a: unknown[]) => api[k as keyof typeof api](...a)])) };
});
vi.mock("./followup-actions", () => {
  const action = vi.fn(async () => undefined);
  return { recordTouchAction: action, createDraftAction: action, approveDraftAction: action, discardDraftAction: action, recordSentAction: action, createPolicyAction: action, syncQuestionsAction: action, decideQuestionAction: action };
});

import LeadFollowupPage from "../leads/[leadId]/followup/page";
import QuestionsPage from "../requirements/[requirementId]/questions/page";
import DuePage from "./page";
import PolicyPage from "./policy/page";

const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const leadProps = (query: Record<string, string> = {}, leadId = LEAD, tenantId = TENANT) =>
  ({ params: Promise.resolve({ tenantId, leadId }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof LeadFollowupPage>[0];
const tenantProps = { params: Promise.resolve({ tenantId: TENANT }) } as unknown as Parameters<typeof DuePage>[0];
const policyProps = { params: Promise.resolve({ tenantId: TENANT }) } as unknown as Parameters<typeof PolicyPage>[0];
const questionProps = (requirementId = REQ) => ({ params: Promise.resolve({ tenantId: TENANT, requirementId }) }) as unknown as Parameters<typeof QuestionsPage>[0];
const lead = (over: Record<string, unknown> = {}) => parseLeadFollowup({ ...FOLLOWUP_JSON, ...over });
const draft = (over: Record<string, unknown>) => ({ ...DRAFT_JSON, ...over });
const noSendControl = () => {
  expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
  expect(screen.queryByRole("link", { name: /^send/i })).toBeNull();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
  requireUser.mockResolvedValue({ id: PERSON, email: "e", accessToken: "tok", aal: "aal2" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  api.fetchLeadFollowup.mockResolvedValue(lead());
  api.fetchDueList.mockResolvedValue(DUE_JSON.map(parseDueItem));
  api.fetchPolicyVersions.mockResolvedValue([parsePolicyVersion(POLICY_JSON)]);
  api.fetchQuestionDrafts.mockResolvedValue([parseQuestionDraft(QUESTION_JSON)]);
});

describe("a Viewer sees nothing on any of these pages, and no data is asked of the API", () => {
  it.each([
    ["lead follow-up", () => LeadFollowupPage(leadProps()), "Follow-up"],
    ["due list", () => DuePage(tenantProps), "Follow-ups due"],
    ["policy", () => PolicyPage(policyProps), "The follow-up policy"],
    ["questions", () => QuestionsPage(questionProps()), "Questions for the customer"],
  ])("%s", async (_name, run, title) => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await run());
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText("Follow-ups are shown to owners, admins and sales users.")).toBeInTheDocument();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(BODY())).toBeNull();
  });
});
const BODY = () => /following up on my earlier message/;

describe("every page says follow-ups are drafts for a person to send outside the system", () => {
  it.each([
    ["lead follow-up", () => LeadFollowupPage(leadProps())],
    ["due list", () => DuePage(tenantProps)],
    ["policy", () => PolicyPage(policyProps)],
    ["questions", () => QuestionsPage(questionProps())],
  ])("%s", async (_name, run) => {
    render(await run());
    expect(screen.getAllByText(/drafts for a person to send outside this system/).length).toBeGreaterThan(0);
    noSendControl();
  });
});

describe("the lead's follow-up page", () => {
  it("is read with the user's own token for the chosen channel (an unknown channel falls back to e-mail)", async () => {
    render(await LeadFollowupPage(leadProps({ channel: "whatsapp" })));
    expect(api.fetchLeadFollowup).toHaveBeenCalledWith("tok", TENANT, LEAD, "whatsapp");
    render(await LeadFollowupPage(leadProps({ channel: "carrier-pigeon" })));
    expect(api.fetchLeadFollowup).toHaveBeenLastCalledWith("tok", TENANT, LEAD, "email");
  });

  it("shows the gate in closed words, the engine's answer as guidance only, the drafts and the touches", async () => {
    render(await LeadFollowupPage(leadProps()));
    expect(screen.getByText("Nothing blocks a follow-up for this lead.")).toBeInTheDocument();
    expect(screen.getByText(/Guidance only: the database decides again/)).toBeInTheDocument();
    expect(screen.getByText("A follow-up draft can be made now. (This would be touch 2.)")).toBeInTheDocument();
    const drafts = within(screen.getByRole("list", { name: "Drafts, newest first" }));
    expect(drafts.getByLabelText("Draft text")).toHaveTextContent("following up on my earlier message");
    expect(within(screen.getByRole("list", { name: "Touches, newest first" })).getByText(/You sent it yourself/)).toBeInTheDocument();
  });

  it("a blocked lead shows why in closed words and the raw reason never appears", async () => {
    api.fetchLeadFollowup.mockResolvedValue(lead({ gate: { ...GATE_JSON, blocked: "key", policy_in_force: false }, decision: null }));
    render(await LeadFollowupPage(leadProps()));
    const list = within(screen.getByRole("list", { name: "What blocks a follow-up" }));
    expect(list.getByText("No follow-up policy is in force: the owner must publish one.")).toBeInTheDocument();
    expect(list.getByText("This e-mail address or phone number is on the do-not-contact list.")).toBeInTheDocument();
    expect(screen.getByText("No guidance: no follow-up policy is in force.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/erased/i);
  });

  it("an owner and an admin see Approve with the draft's own fingerprint; the text shown is the text reviewed", async () => {
    for (const role of ["owner", "admin"]) {
      fetchTenant.mockResolvedValue(tenant(role));
      const { unmount } = render(await LeadFollowupPage(leadProps()));
      expect(screen.getByRole("button", { name: "Approve this text" })).toBeInTheDocument();
      expect((document.querySelector('input[name="state_hash"]') as HTMLInputElement).value).toBe(HASH);
      expect(screen.getByLabelText("Draft text")).toHaveTextContent(DRAFT_JSON.body);
      unmount();
    }
  });

  it("without the authenticator session the owner sees the notice instead of the Approve button", async () => {
    requireUser.mockResolvedValue({ id: PERSON, email: "e", accessToken: "tok", aal: "aal1" });
    render(await LeadFollowupPage(leadProps()));
    expect(screen.queryByRole("button", { name: "Approve this text" })).toBeNull();
    expect(screen.getByText(/Approving needs your authenticator app/)).toBeInTheDocument();
  });

  it("Sales cannot approve; she can discard her own draft but not another person's", async () => {
    fetchTenant.mockResolvedValue(tenant("sales"));
    render(await LeadFollowupPage(leadProps()));
    expect(screen.queryByRole("button", { name: "Approve this text" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard this draft" })).toBeInTheDocument();
    api.fetchLeadFollowup.mockResolvedValue(lead({ drafts: [draft({ created_by: OTHER_PERSON })] }));
    document.body.innerHTML = "";
    render(await LeadFollowupPage(leadProps()));
    expect(screen.queryByRole("button", { name: "Discard this draft" })).toBeNull();
  });

  it("an approved draft offers 'Record: I sent it myself' and not Approve; a closed draft offers no action and shows no text", async () => {
    api.fetchLeadFollowup.mockResolvedValue(lead({ drafts: [draft({ status: "approved", approved_by: PERSON, approved_at: "2026-10-07T07:00:00+00:00" }), draft({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", status: "discarded", discard_code: "superseded" })] }));
    render(await LeadFollowupPage(leadProps()));
    expect(screen.getAllByRole("button", { name: "Record: I sent it myself" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Approve this text" })).toBeNull();
    expect(screen.getAllByLabelText("Draft text")).toHaveLength(1);
    noSendControl();
  });

  it("the forms: the channel for a draft and the record of a touch; no free text for wording anywhere", async () => {
    render(await LeadFollowupPage(leadProps()));
    expect(screen.getByRole("button", { name: "Ask for a draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record this" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("malformed ids are not found; an unknown lead is not found; a rejected session goes to sign-in; an outage is said plainly", async () => {
    await expect(LeadFollowupPage(leadProps({}, "x"))).rejects.toThrow("not found");
    await expect(LeadFollowupPage(leadProps({}, LEAD, "x"))).rejects.toThrow("not found");
    api.fetchLeadFollowup.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(LeadFollowupPage(leadProps())).rejects.toThrow("not found");
    api.fetchLeadFollowup.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => LeadFollowupPage(leadProps()))).toBe("/login");
    api.fetchLeadFollowup.mockRejectedValue(new ApiRequestError(503, "followups_unavailable", "x"));
    render(await LeadFollowupPage(leadProps()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });

  it("an engine outage on the API does not hide the lead's drafts and touches", async () => {
    api.fetchLeadFollowup.mockResolvedValue(lead({ decision: null }));
    render(await LeadFollowupPage(leadProps()));
    expect(screen.getByText(/No guidance could be given right now/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Drafts, newest first" })).toBeInTheDocument();
  });
});

describe("the due list", () => {
  it("lists each lead with our sentence and a link to its follow-up page; a waiting draft is mentioned", async () => {
    api.fetchDueList.mockResolvedValue([...DUE_JSON, { ...DUE_JSON[0], lead_id: "44444444-4444-4444-8444-444444444444", action: "wait", reason_code: "not_yet_eligible", open_draft_id: DRAFT }].map(parseDueItem));
    render(await DuePage(tenantProps));
    const items = within(screen.getByRole("list", { name: "Leads with a follow-up" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Due now");
    expect(items[1]).toHaveTextContent("Not yet");
    expect(items[1]).toHaveTextContent("A draft is waiting");
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", `/app/tenants/${TENANT}/leads/${LEAD}/followup`);
    expect(screen.getByText(/Worked out when you opened this page/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The follow-up policy" })).toHaveAttribute("href", `/app/tenants/${TENANT}/followups/policy`);
  });

  it("says plainly when there is nothing, and when the API is down", async () => {
    api.fetchDueList.mockResolvedValue([]);
    render(await DuePage(tenantProps));
    expect(screen.getByText(/Nothing to follow up/)).toBeInTheDocument();
    api.fetchDueList.mockRejectedValue(new ApiRequestError(503, "followups_unavailable", "x"));
    render(await DuePage(tenantProps));
    expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Could not load this from the API.");
  });
});

describe("the policy page", () => {
  it("the owner sees the versions and the form to publish one", async () => {
    render(await PolicyPage(policyProps));
    const item = within(screen.getByRole("list", { name: "Policy versions, newest first" })).getByRole("listitem");
    expect(item).toHaveTextContent("Version 1");
    expect(item).toHaveTextContent("Touches at most3");
    expect(screen.getByRole("button", { name: "Publish this policy" })).toBeInTheDocument();
  });

  it("the owner without the authenticator session sees the notice instead of the form", async () => {
    requireUser.mockResolvedValue({ id: PERSON, email: "e", accessToken: "tok", aal: "aal1" });
    render(await PolicyPage(policyProps));
    expect(screen.queryByRole("button", { name: "Publish this policy" })).toBeNull();
    expect(screen.getByText(/Publishing a policy needs your authenticator app/)).toBeInTheDocument();
  });

  it.each(["admin", "sales"])("a %s user reads the versions but is not offered the form", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await PolicyPage(policyProps));
    expect(screen.getByText("Only the owner publishes a policy.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish this policy" })).toBeNull();
    expect(screen.getByRole("list", { name: "Policy versions, newest first" })).toBeInTheDocument();
  });

  it("with no version it says no draft can be made yet", async () => {
    api.fetchPolicyVersions.mockResolvedValue([]);
    render(await PolicyPage(policyProps));
    expect(screen.getByText(/No policy yet/)).toBeInTheDocument();
  });
});

describe("the questions page", () => {
  it("shows the stored questions with approve and discard, and the update button; no free text", async () => {
    render(await QuestionsPage(questionProps()));
    expect(api.fetchQuestionDrafts).toHaveBeenCalledWith("tok", TENANT, REQ, false);
    expect(screen.getByLabelText("Draft text")).toHaveTextContent("Which city should we deliver to?");
    expect(screen.getByRole("button", { name: "Approve this question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard this question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update the questions from the requirement" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    noSendControl();
  });

  it("an approved question can be discarded but not approved again; a discarded one shows no text and no buttons", async () => {
    api.fetchQuestionDrafts.mockResolvedValue([
      parseQuestionDraft({ ...QUESTION_JSON, status: "approved", decided_by: PERSON, decided_at: "2026-10-07T07:00:00+00:00" }),
      parseQuestionDraft({ ...QUESTION_JSON, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", status: "discarded", decided_by: PERSON, decided_at: "2026-10-07T07:00:00+00:00", discard_code: "person" }),
    ]);
    render(await QuestionsPage(questionProps()));
    expect(screen.queryByRole("button", { name: "Approve this question" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Discard this question" })).toHaveLength(1);
    expect(screen.getAllByLabelText("Draft text")).toHaveLength(1);
  });

  it("says so when none are stored; an unknown requirement is not found", async () => {
    api.fetchQuestionDrafts.mockResolvedValue([]);
    render(await QuestionsPage(questionProps()));
    expect(screen.getByText(/No questions stored/)).toBeInTheDocument();
    api.fetchQuestionDrafts.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(QuestionsPage(questionProps())).rejects.toThrow("not found");
    await expect(QuestionsPage(questionProps("x"))).rejects.toThrow("not found");
  });
});
