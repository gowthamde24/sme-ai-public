import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const A = {
  replyAction: vi.fn(),
  statusAction: vi.fn(),
  assignAction: vi.fn(),
  pauseAction: vi.fn(),
  resumeAction: vi.fn(),
  creditAction: vi.fn(),
  confirmCodeAction: vi.fn(),
  unmaskAction: vi.fn(),
  openAccessAction: vi.fn(),
};
vi.mock("@/app/staff/actions", () => ({
  replyAction: (...a: unknown[]) => A.replyAction(...a),
  statusAction: (...a: unknown[]) => A.statusAction(...a),
  assignAction: (...a: unknown[]) => A.assignAction(...a),
  pauseAction: (...a: unknown[]) => A.pauseAction(...a),
  resumeAction: (...a: unknown[]) => A.resumeAction(...a),
  creditAction: (...a: unknown[]) => A.creditAction(...a),
  confirmCodeAction: (...a: unknown[]) => A.confirmCodeAction(...a),
  unmaskAction: (...a: unknown[]) => A.unmaskAction(...a),
  openAccessAction: (...a: unknown[]) => A.openAccessAction(...a),
  searchStaffAction: vi.fn(),
  staffSignOutAction: vi.fn(),
}));

import { businessesJson, supportViewJson, threadJson, ticketId, ticketsJson } from "@/lib/staff/staff-fixtures";
import { parseBusinessList, parseSupportView, parseThread, parseTicketList } from "@/lib/staff/types";

import { BusinessesTable } from "./BusinessesTable";
import { GoodwillCredit } from "./GoodwillCredit";
import { PauseResume } from "./PauseResume";
import { PeopleLists } from "./PeopleLists";
import { SupportInbox } from "./SupportInbox";
import { SupportViewBody } from "./SupportViewBody";
import { TicketThreadView } from "./TicketThreadView";

const NOW = new Date("2026-11-14T06:00:00Z");
const BIZ = "00000000-0000-4000-8000-000000000003";
const assign = vi.fn();
const location = { assign };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", location);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const thread = (i = 1) => parseThread(threadJson(ticketId(i), NOW));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const pickReason = (label: RegExp = /A support ticket/) => fireEvent.click(screen.getByRole("radio", { name: label }));

describe("the support inbox", () => {
  it("status chips are links (Active by default), tickets link to their thread, with priority, channel, wait and assignee", () => {
    render(<SupportInbox list={parseTicketList(ticketsJson("active", NOW))} status="active" keep="" />);
    const chips = within(screen.getByRole("navigation", { name: "Ticket status" }));
    expect(chips.getByRole("link", { name: "Active" })).toHaveAttribute("aria-current", "true");
    expect(chips.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/staff/support?status=open");
    expect(chips.getByRole("link", { name: "Waiting for the shop" })).toHaveAttribute("href", "/staff/support?status=waiting");
    expect(chips.getByRole("link", { name: "Closed" })).toHaveAttribute("href", "/staff/support?status=closed");
    const first = document.querySelector('[data-part="ticket"]') as HTMLElement;
    expect(first).toHaveAttribute("href", `/staff/support/${ticketId(0)}`);
    expect(first).toHaveTextContent("Urgent");
    expect(first).toHaveTextContent("Sri Venkateswara Sarees");
    expect(first).toHaveTextContent("Phone · 12 min");
    expect(first).toHaveTextContent("Ravi K.");
  });
  it("keeps the mock role on every link, and says so when there is nothing", () => {
    const { rerender } = render(<SupportInbox list={parseTicketList(ticketsJson("closed", NOW))} status="closed" keep="?role=support" />);
    expect(screen.getByText("No tickets here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/staff/support?role=support&status=open");
    rerender(<SupportInbox list={parseTicketList(ticketsJson("active", NOW))} status="active" keep="?role=support" />);
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("href", "/staff/support?role=support");
    expect(document.querySelector('[data-part="ticket"]')).toHaveAttribute("href", `/staff/support/${ticketId(0)}?role=support`);
  });
});

describe("a ticket thread", () => {
  it("draws the messages oldest first; an undelivered reply says 'Saved on the ticket, not sent yet'; a note is marked internal", () => {
    render(<TicketThreadView initial={thread(2)} myStaffId="staff-owner" />);
    expect(screen.getByText("Saved on the ticket, not sent yet")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
    cleanup();
    render(<TicketThreadView initial={thread(0)} myStaffId="staff-owner" />);
    expect(screen.getByText("Internal note")).toBeInTheDocument();
    expect(screen.queryByText("Saved on the ticket, not sent yet")).toBeNull();
  });
  it("a reply is sent as a reply, the thread it answers with replaces the old one, the box empties", async () => {
    A.replyAction.mockResolvedValue({ ok: true, data: parseThread(threadJson(ticketId(1), NOW, { tickets: { "1": { status: "waiting", msgs: [{ k: "r", b: "On it.", t: NOW.getTime() }] } }, paused: [], credited: {}, fresh: 0 })) });
    render(<TicketThreadView initial={thread(1)} myStaffId="staff-owner" />);
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
    type(screen.getByRole("textbox"), "On it.");
    fireEvent.click(screen.getByRole("button", { name: "Save reply" }));
    await waitFor(() => expect(screen.getByText("On it.")).toBeInTheDocument());
    expect(A.replyAction).toHaveBeenCalledWith(ticketId(1), "On it.", "reply");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Waiting for the shop" })).toBeDisabled(); // it is the current status
  });
  it("an internal note is sent as a note; an empty box says so and sends nothing", async () => {
    A.replyAction.mockResolvedValue({ ok: true, data: thread(1) });
    render(<TicketThreadView initial={thread(1)} myStaffId="staff-owner" />);
    fireEvent.click(screen.getByRole("button", { name: "Save reply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write something first");
    expect(A.replyAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Internal note/ }));
    type(screen.getByRole("textbox"), "Call the shop tomorrow");
    fireEvent.click(screen.getByRole("button", { name: "Save internal note" }));
    await waitFor(() => expect(A.replyAction).toHaveBeenCalledWith(ticketId(1), "Call the shop tomorrow", "note"));
  });
  it("a closed ticket refuses a reply in plain words: reopen it first; a session that ended goes to its own page", async () => {
    A.replyAction.mockResolvedValueOnce({ ok: false, failure: "ticket_closed" }).mockResolvedValueOnce({ ok: false, failure: "signed_out" });
    render(<TicketThreadView initial={thread(1)} myStaffId="staff-owner" />);
    type(screen.getByRole("textbox"), "hello");
    fireEvent.click(screen.getByRole("button", { name: "Save reply" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Reopen it first"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save reply" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save reply" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/staff/signed-out"));
  });
  it("status and assignee changes call the actions; 'Assign to me' hides once it is mine", async () => {
    A.statusAction.mockResolvedValue({ ok: true, data: parseThread(threadJson(ticketId(1), NOW, { tickets: { "1": { status: "closed" } }, paused: [], credited: {}, fresh: 0 })) });
    A.assignAction.mockResolvedValue({ ok: true, data: { ...thread(1), assignee: "Gowtham", assigneeId: "staff-owner" } });
    render(<TicketThreadView initial={thread(1)} myStaffId="staff-owner" />);
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    await waitFor(() => expect(A.statusAction).toHaveBeenCalledWith(ticketId(1), "closed"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Closed" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(A.assignAction).toHaveBeenCalledWith(ticketId(1), "me"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull());
    expect(screen.getByRole("button", { name: "Unassign" })).toBeInTheDocument();
    expect(screen.getByText("Gowtham", { selector: '[data-part="assignee"]' })).toBeInTheDocument();
  });
});

describe("the businesses list", () => {
  it("shows plan, balance, status and activity, a search box, View (owner, support) and Goodwill credit (owner, finance)", () => {
    const list = parseBusinessList(businessesJson("", NOW));
    const { rerender } = render(<BusinessesTable list={list} q="" role="owner" nowIso={NOW.toISOString()} keepRole="" />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: /^Goodwill credit:/ })).toHaveLength(6);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    rerender(<BusinessesTable list={list} q="" role="support" nowIso={NOW.toISOString()} keepRole="support" />);
    expect(screen.queryAllByRole("button", { name: /^Goodwill credit:/ })).toHaveLength(0);
    expect(document.querySelector('input[name="role"]')).toHaveAttribute("value", "support");
    rerender(<BusinessesTable list={list} q="" role="finance" nowIso={NOW.toISOString()} keepRole="finance" />);
    expect(screen.queryAllByRole("button", { name: /^View / })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Goodwill credit:/ })).toHaveLength(6);
  });
  it("an empty search says so", () => {
    render(<BusinessesTable list={parseBusinessList(businessesJson("zzz", NOW))} q="zzz" role="owner" nowIso={NOW.toISOString()} keepRole="" />);
    expect(screen.getByText("No businesses found.")).toBeInTheDocument();
  });
});

describe("pause and resume", () => {
  it("pause asks for a reason with words first, then asks the API and refreshes the page", async () => {
    A.pauseAction.mockResolvedValue({ ok: true, data: {} });
    render(<PauseResume tenantId={BIZ} name="Lakshmi Textiles" paused={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause assistant" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Pause the assistant of Lakshmi Textiles?");
    expect(screen.getByRole("dialog")).toHaveTextContent("Stack19 support paused your assistant");
    fireEvent.click(screen.getByRole("button", { name: "Pause now" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a reason");
    pickReason(/An incident/);
    fireEvent.click(screen.getByRole("button", { name: "Pause now" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say what for");
    type(screen.getByRole("textbox"), "Calls loop on the greeting");
    fireEvent.click(screen.getByRole("button", { name: "Pause now" }));
    await waitFor(() => expect(A.pauseAction).toHaveBeenCalledWith(BIZ, "incident", "Calls loop on the greeting"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a paused assistant offers Resume; 'nothing of support's to lift' is said in words, not hidden", async () => {
    A.resumeAction.mockResolvedValue({ ok: false, failure: "invalid" });
    render(<PauseResume tenantId={BIZ} name="Lakshmi Textiles" paused />);
    fireEvent.click(screen.getByRole("button", { name: "Resume assistant" }));
    pickReason(/A support ticket/);
    type(screen.getByRole("textbox"), "Fixed the greeting");
    fireEvent.click(screen.getByRole("button", { name: "Resume now" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("nothing of support's to lift"));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("goodwill credit", () => {
  const fill = (amount = "500", again = "500") => {
    fireEvent.click(screen.getByRole("button", { name: /^Goodwill credit/ }));
    type(screen.getByLabelText("Amount in ₹ (100 to 1,000)"), amount);
    type(screen.getByLabelText("Type the amount again"), again);
    pickReason(/A billing question/);
    type(screen.getByLabelText(/Why\? \(always needed/), "Double charged in October");
  };
  it("checks the amount, the second typing and the words before anything is sent", async () => {
    render(<GoodwillCredit tenantId={BIZ} name="Lakshmi Textiles" />);
    fill("50", "50");
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("whole number of rupees from 100 to 1,000"));
    type(screen.getByLabelText("Amount in ₹ (100 to 1,000)"), "500");
    type(screen.getByLabelText("Type the amount again"), "400");
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not the same"));
    type(screen.getByLabelText("Type the amount again"), "500");
    type(screen.getByLabelText(/Why\? \(always needed/), "no");
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("say why"));
    expect(A.creditAction).not.toHaveBeenCalled();
  });
  it("sends paise, both amounts and ONE key; a fresh code is asked when the API says so, then the SAME key is sent again and the result is said", async () => {
    A.creditAction.mockResolvedValueOnce({ ok: false, failure: "second_confirm_required" }).mockResolvedValueOnce({ ok: true, data: { creditedText: "₹500", balanceText: "₹4,710", replayed: false } });
    A.confirmCodeAction.mockResolvedValue({ ok: true });
    render(<GoodwillCredit tenantId={BIZ} name="Lakshmi Textiles" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Enter your authenticator code again"));
    const first = A.creditAction.mock.calls[0][1];
    expect(first).toMatchObject({ amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "Double charged in October" });
    expect(first.key).toMatch(/^gw-/);
    type(screen.getByLabelText("6-digit code"), "123456");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and add credit" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Added ₹500. The balance is now ₹4,710."));
    expect(A.confirmCodeAction).toHaveBeenCalledWith("123456");
    expect(A.creditAction.mock.calls[1][1].key).toBe(first.key);
    expect(refresh).toHaveBeenCalled();
  });
  it("a wrong code stays on the code step; a replayed credit says nothing more was added; the limit is plain", async () => {
    A.creditAction.mockResolvedValueOnce({ ok: false, failure: "second_confirm_required" }).mockResolvedValueOnce({ ok: true, data: { creditedText: "₹500", balanceText: "₹4,710", replayed: true } });
    A.confirmCodeAction.mockResolvedValueOnce({ ok: false, failure: "invalid" }).mockResolvedValueOnce({ ok: true });
    render(<GoodwillCredit tenantId={BIZ} name="Lakshmi Textiles" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await screen.findByLabelText("6-digit code");
    type(screen.getByLabelText("6-digit code"), "000000");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and add credit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That code did not work"));
    expect(A.creditAction).toHaveBeenCalledTimes(1);
    type(screen.getByLabelText("6-digit code"), "123456");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and add credit" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("already added. Nothing more was added."));
  });
  it("over the limit: a plain sentence, nothing added, and the next click is a new key", async () => {
    A.creditAction.mockResolvedValue({ ok: false, failure: "goodwill_limit" });
    render(<GoodwillCredit tenantId={BIZ} name="Lakshmi Textiles" />);
    fill("1000", "1000");
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("₹3,000 per business in 30 days"));
    fireEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await waitFor(() => expect(A.creditAction).toHaveBeenCalledTimes(2));
    expect(A.creditAction.mock.calls[1][1].key).not.toBe(A.creditAction.mock.calls[0][1].key);
  });
});

describe("unmasking", () => {
  const view = () => parseSupportView(supportViewJson(BIZ, NOW));
  const draw = (canUnmask = true) => {
    const v = view();
    return render(<PeopleLists calls={v.recentCalls} chats={v.recentChats} tenantId={BIZ} accessId={`mock-access-${BIZ}`} canUnmask={canUnmask} />);
  };
  it("shows masked names and numbers and a button only for owner and support", () => {
    draw();
    expect(screen.getAllByText("P•••••• N••••").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Show real names and numbers/ })).toBeInTheDocument();
    cleanup();
    draw(false);
    expect(screen.queryByRole("button", { name: /Show real names and numbers/ })).toBeNull();
  });
  it("a second reason with words, then the real names for THIS look with a clear banner; Hide again masks them", async () => {
    A.unmaskAction.mockResolvedValue({ ok: true, data: { calls: [{ id: "c1", customer: "Padmaja Naidu", customerPhone: "+91 98480 00210" }], chats: [{ leadId: "l1", customer: "Padmaja Naidu", customerPhone: "+91 98480 00210" }] } });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Show real names and numbers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show for this look" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a reason");
    pickReason(/The business asked/);
    type(screen.getByRole("textbox"), "They asked who called");
    fireEvent.click(screen.getByRole("button", { name: "Show for this look" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Unmasked for this look"));
    expect(A.unmaskAction).toHaveBeenCalledWith(BIZ, `mock-access-${BIZ}`, "customer_asked", "They asked who called");
    expect(screen.getAllByText("Padmaja Naidu").length).toBe(2);
    expect(screen.getAllByText("K••••• R•••").length).toBe(1); // not in this look's answer: stays masked
    fireEvent.click(screen.getByRole("button", { name: "Hide again" }));
    expect(screen.queryByText("Padmaja Naidu")).toBeNull();
    expect(screen.getByRole("button", { name: /Show real names and numbers/ })).toBeInTheDocument(); // and the next look asks again
  });
  it("an ended access is said in words; the dialog stays open", async () => {
    A.unmaskAction.mockResolvedValue({ ok: false, failure: "access_required" });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Show real names and numbers/ }));
    pickReason(/An incident/);
    type(screen.getByRole("textbox"), "Checking a complaint");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show for this look" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your access to this business ended"));
  });
});

describe("the support view body", () => {
  it("owner: pause, goodwill credit and unmask; support: no credit; finance (cannot open it) gets none; a paused assistant says so and offers Resume", () => {
    const v = parseSupportView(supportViewJson(BIZ, NOW));
    const props = { view: v, keep: "", tenantId: BIZ, accessId: `mock-access-${BIZ}` };
    const { rerender } = render(<SupportViewBody {...props} role="owner" />);
    expect(screen.getByRole("button", { name: "Resume assistant" })).toBeInTheDocument(); // Lakshmi Textiles is paused in the sample
    expect(screen.getByText("Support has paused this assistant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Goodwill credit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show real names/ })).toBeInTheDocument();
    rerender(<SupportViewBody {...props} role="support" />);
    expect(screen.queryByRole("button", { name: /^Goodwill credit/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Show real names/ })).toBeInTheDocument();
    rerender(<SupportViewBody {...props} role="finance" />);
    expect(screen.queryByRole("button", { name: /assistant$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show real names/ })).toBeNull();
  });
});
