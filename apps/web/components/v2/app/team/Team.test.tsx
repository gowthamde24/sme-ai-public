import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { Invitation, Member } from "@/lib/api/team";

import { InviteForm } from "./InviteForm";
import { Invitations } from "./Invitations";
import { JoinForm } from "./JoinForm";
import { TeamMembers } from "./TeamMembers";
import { canRemove, changeableTo, invitableRoles, labelProblem, mailShare, owlOf, shareText, whatsappShare } from "./team-model";
import type { TeamActions } from "./team-types";
import { makeT } from "../words";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));

const WORDS = wordsFor("en", ["team.", "apierr.", "problem."], ["dta.btn.working", "dta.btn.copied", "dta.cal.copy_failed"]);
const t = makeT(WORDS);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number, over: Partial<Member> = {}): Member => ({ user_id: U(n), display_name: `Person ${n}`, role: "sales", joined_at: "2026-10-01T10:00:00Z", is_you: false, ...over });
const inv = (over: Partial<Invitation> = {}): Invitation => ({ id: U(90), role: "sales", label: "for the cutter", status: "pending", created_at: "2026-10-12T10:00:00Z", expires_at: "2026-10-19T10:00:00Z", accepted_at: null, revoked_at: null, created_by_name: "Asha", ...over });
const fail = (kind: string, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, kind: kind as never, error: "", ...(code ? { code } : {}), ...extra });
const actions = (over: Partial<TeamActions> = {}): TeamActions => ({
  invite: vi.fn(async () => ({ ok: true as const, data: { ...inv(), code: "7QX2K-M9R4D-0A1B2-C3D4E", replayed: false } })),
  revoke: vi.fn(async () => ({ ok: true as const, data: inv({ status: "revoked" }) })),
  changeRole: vi.fn(async (_u: string, role: string) => ({ ok: true as const, data: { user_id: U(2), role: role as never, changed: true } })),
  remove: vi.fn(async () => ({ ok: true as const, data: { user_id: U(2), leads_unassigned: 3, opportunities_unassigned: 1, runs_cancelled: 0, invitations_revoked: 0 } })),
  ...over,
});
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("who may do what (the API decides again)", () => {
  it("an owner invites any role but an owner, an admin sales and viewer, others nobody", () => {
    expect(invitableRoles("owner")).toEqual(["admin", "sales", "viewer"]);
    expect(invitableRoles("admin")).toEqual(["sales", "viewer"]);
    expect(invitableRoles("sales")).toEqual([]);
    expect(invitableRoles("viewer")).toEqual([]);
  });
  it("nobody changes an owner or their own role; an admin changes only sales and viewer", () => {
    expect(changeableTo("owner", { role: "owner", is_you: false })).toEqual([]);
    expect(changeableTo("owner", { role: "sales", is_you: true })).toEqual([]);
    expect(changeableTo("owner", { role: "sales", is_you: false })).toEqual(["admin", "sales", "viewer"]);
    expect(changeableTo("admin", { role: "admin", is_you: false })).toEqual([]);
    expect(changeableTo("admin", { role: "viewer", is_you: false })).toEqual(["sales", "viewer"]);
    expect(changeableTo("sales", { role: "viewer", is_you: false })).toEqual([]);
  });
  it("anyone but an owner may leave; an owner removes anyone but an owner; an admin sales and viewer", () => {
    expect(canRemove("sales", { role: "sales", is_you: true })).toBe(true);
    expect(canRemove("owner", { role: "owner", is_you: true })).toBe(false);
    expect(canRemove("owner", { role: "owner", is_you: false })).toBe(false);
    expect(canRemove("owner", { role: "admin", is_you: false })).toBe(true);
    expect(canRemove("admin", { role: "admin", is_you: false })).toBe(false);
    expect(canRemove("admin", { role: "sales", is_you: false })).toBe(true);
    expect(canRemove("sales", { role: "viewer", is_you: false })).toBe(false);
  });
  it("gives a person the same owl every time, one of the seven", () => {
    expect(owlOf(U(1))).toBe(owlOf(U(1)));
    expect(new Set(Array.from({ length: 60 }, (_, i) => owlOf(U(i)))).size).toBeGreaterThan(3);
  });
  it("a label with an @ or seven digits is refused as the API would", () => {
    expect(labelProblem("for the new cutter")).toBe(false);
    expect(labelProblem("a@b.test")).toBe(true);
    expect(labelProblem("call 98765 43210")).toBe(true);
    expect(labelProblem("x".repeat(61))).toBe(true);
  });
  it("builds the WhatsApp and e-mail links from the message, encoded", () => {
    const text = shareText(t, "Acme Silks", "https://app.test/app/join#code=ABC", "ABC");
    expect(text).toContain("Acme Silks");
    expect(whatsappShare(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(mailShare("S & T", text)).toMatch(/^mailto:\?subject=S%20%26%20T&body=/);
  });
});

describe("the people", () => {
  const members = [member(1, { role: "owner", is_you: true, display_name: "Asha" }), member(2, { role: "sales" }), member(3, { role: "admin" }), member(4, { role: "viewer", display_name: null })];
  it("shows each person with an owl, their role in words, 'you' on one's own row", () => {
    const { container } = render(<TeamMembers words={WORDS} members={members} myRole="owner" actions={actions()} />);
    expect(container.querySelectorAll("svg.owl")).toHaveLength(4);
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("Team member")).toBeInTheDocument(); // a person with no name
    expect(screen.getByText("Owners are added by the operator, not here.")).toBeInTheDocument();
    const owner = container.querySelector('[data-member="owner"]')!;
    expect(within(owner as HTMLElement).queryByRole("button")).toBeNull(); // no way to change or remove an owner, or to leave as the owner
  });
  it("an owner changes a role and the row shows the new one", async () => {
    const a = actions();
    render(<TeamMembers words={WORDS} members={members} myRole="owner" actions={a} />);
    const row = screen.getByText("Person 2").closest("li")!;
    fireEvent.change(within(row).getByLabelText("Role"), { target: { value: "viewer" } });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Change role" })));
    expect(a.changeRole).toHaveBeenCalledWith(U(2), "viewer");
    expect(screen.getByRole("status")).toHaveTextContent("Role changed.");
  });
  it("an admin has no controls on another admin or on the owner", () => {
    render(<TeamMembers words={WORDS} members={members} myRole="admin" actions={actions()} />);
    expect(within(screen.getByText("Person 3").closest("li")!).queryByRole("button")).toBeNull();
    expect(within(screen.getByText("Person 2").closest("li")!).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
  it("removing asks first, takes a reason from a short list and says what was tidied, in counts", async () => {
    const a = actions();
    render(<TeamMembers words={WORDS} members={members} myRole="owner" actions={a} />);
    const row = screen.getByText("Person 2").closest("li")!;
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Remove" })));
    expect(within(row).getByText("Remove Person 2 from this business? They lose access at once.")).toBeInTheDocument();
    expect(a.remove).not.toHaveBeenCalled();
    fireEvent.change(within(row).getByLabelText("Why?"), { target: { value: "security_concern" } });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Yes, remove" })));
    expect(a.remove).toHaveBeenCalledWith(U(2), "security_concern");
    expect(screen.queryByText("Person 2")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Removed. 3 leads and 1 opportunities now have no owner; 0 agent tasks were stopped.");
  });
  it("a salesperson can leave: the reason is 'left', and they go to their workspaces", async () => {
    const a = actions();
    render(<TeamMembers words={WORDS} members={[member(1, { role: "owner" }), member(2, { is_you: true })]} myRole="sales" actions={a} />);
    await press("Leave this business");
    await press("Yes, leave");
    expect(a.remove).toHaveBeenCalledWith(U(2), "left");
    expect(push).toHaveBeenCalledWith("/app");
  });
  it.each([
    [fail("forbidden", "role_not_allowed"), /cannot do that with your role/],
    [fail("conflict", "keep_owner"), /only owner cannot leave/],
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("rate_limited", undefined, { retryAfter: 20 }), /Wait 20 seconds/],
  ])("a refusal (%j) is said in words and the person stays", async (reply, words) => {
    render(<TeamMembers words={WORDS} members={members} myRole="owner" actions={actions({ remove: vi.fn(async () => reply) })} />);
    const row = screen.getByText("Person 2").closest("li")!;
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Remove" })));
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Yes, remove" })));
    expect(within(row).getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByText("Person 2")).toBeInTheDocument();
  });
  it("a person's own name is drawn as text", () => {
    render(<TeamMembers words={WORDS} members={[member(1, { display_name: "<b>x</b>" })]} myRole="viewer" actions={actions()} />);
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
  });
});

describe("inviting", () => {
  it("shows nothing to a salesperson", () => {
    const { container } = render(<InviteForm words={WORDS} myRole="sales" workspaceName="Acme Silks" actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("offers an admin sales and viewer only, an owner admin too, never owner", () => {
    render(<InviteForm words={WORDS} myRole="admin" workspaceName="Acme Silks" actions={actions()} />);
    expect(within(screen.getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sales", "Viewer"]);
    cleanup();
    render(<InviteForm words={WORDS} myRole="owner" workspaceName="Acme Silks" actions={actions()} />);
    expect(within(screen.getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Admin", "Sales", "Viewer"]);
  });
  it("makes the code, shows it once with the warning, the share links and the join address with the code after a #", async () => {
    const a = actions();
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InviteForm words={WORDS} myRole="owner" workspaceName="Acme Silks" actions={a} />);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "sales" } });
    fireEvent.change(screen.getByLabelText("The code works for"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "for the cutter" } });
    await press("Make an invitation code");
    expect(a.invite).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "sales", 14, "for the cutter");
    expect(screen.getByText("7QX2K-M9R4D-0A1B2-C3D4E")).toBeInTheDocument();
    expect(screen.getByText(/Give this code to the person yourself\. It works once, for 7 days, and nobody can read it again\./)).toBeInTheDocument();
    expect(screen.getByText(/\/app\/join#code=7QX2K-M9R4D-0A1B2-C3D4E$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send by WhatsApp" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/wa\.me\/\?text=/));
    expect(screen.getByRole("link", { name: "Send by e-mail" })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
    expect(screen.getByText("Nothing is sent from here. You pass the code on yourself.")).toBeInTheDocument();
    await press("Copy the code");
    expect(writeText).toHaveBeenCalledWith("7QX2K-M9R4D-0A1B2-C3D4E");
    expect(screen.getByLabelText(/Label/)).toHaveValue(""); // ready for the next one
  });
  it("a retry that has no code says it cannot be shown again", async () => {
    render(<InviteForm words={WORDS} myRole="owner" workspaceName="Acme" actions={actions({ invite: vi.fn(async () => ({ ok: true as const, data: { ...inv(), code: null, replayed: true } })) })} />);
    await press("Make an invitation code");
    expect(screen.getByText(/its code cannot be shown again/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Send by WhatsApp" })).toBeNull();
  });
  it("a label with a phone number is stopped before asking", async () => {
    const a = actions();
    render(<InviteForm words={WORDS} myRole="owner" workspaceName="Acme" actions={a} />);
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "call 9876543210" } });
    await press("Make an invitation code");
    expect(screen.getByRole("alert")).toHaveTextContent("Take out the phone number or e-mail address.");
    expect(a.invite).not.toHaveBeenCalled();
  });
  it.each([
    [fail("conflict", "too_many_invitations"), /20 invitations are waiting/],
    [fail("forbidden", "role_not_allowed"), /cannot do that with your role/],
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("rate_limited", undefined, { retryAfter: 11 }), /Wait 11 seconds/],
  ])("a refusal (%j) is said in words and nothing is shown as a code", async (reply, words) => {
    render(<InviteForm words={WORDS} myRole="owner" workspaceName="Acme" actions={actions({ invite: vi.fn(async () => reply) })} />);
    await press("Make an invitation code");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(document.querySelector("[data-invite-code]")).toBeNull();
  });
});

describe("the invitations", () => {
  it("lists them with the label, the role in words, the status, the end, and never a code", () => {
    render(<Invitations words={WORDS} myRole="owner" items={[inv(), inv({ id: U(91), status: "accepted", label: null, role: "admin" })]} actions={actions()} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("for the cutter")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Waiting")).toBeInTheDocument();
    expect(within(rows[2]).getByText("(no label)")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Used")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Cancel invitation/ })).toHaveLength(1);
  });
  it("revokes a waiting one", async () => {
    const a = actions();
    render(<Invitations words={WORDS} myRole="owner" items={[inv()]} actions={a} />);
    await press(/Cancel invitation/);
    expect(a.revoke).toHaveBeenCalledWith(U(90));
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
  it("an admin cannot cancel an invitation for an admin", () => {
    render(<Invitations words={WORDS} myRole="admin" items={[inv({ role: "admin" }), inv({ id: U(91), role: "viewer" })]} actions={actions()} />);
    expect(screen.getAllByRole("button", { name: /Cancel invitation/ })).toHaveLength(1);
  });
  it("an empty list says so; a refusal is in words", async () => {
    render(<Invitations words={WORDS} myRole="owner" items={[]} actions={actions()} />);
    expect(screen.getByText("No invitations yet.")).toBeInTheDocument();
    cleanup();
    render(<Invitations words={WORDS} myRole="owner" items={[inv()]} actions={actions({ revoke: vi.fn(async () => fail("conflict", "invitation_not_pending")) })} />);
    await press(/Cancel invitation/);
    expect(screen.getByRole("alert")).toHaveTextContent("already used or cancelled");
  });
});

describe("joining with a code", () => {
  const ok = { ok: true as const, data: { tenant_id: U(7), tenant_name: "Acme Silks", role: "sales" as const } };
  it("takes the code from the address's fragment into the box and out of the address bar", async () => {
    window.history.replaceState(null, "", "/app/join#code=7QX2K-M9R4D-0A1B2-C3D4E");
    render(<JoinForm words={WORDS} accept={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Invitation code")).toHaveValue("7QX2K-M9R4D-0A1B2-C3D4E"));
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/app/join");
  });
  it("sends the code as typed and goes to the business", async () => {
    window.history.replaceState(null, "", "/app/join");
    const accept = vi.fn(async () => ok);
    render(<JoinForm words={WORDS} accept={accept} />);
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: " 7qx2k m9r4d " } });
    await press("Join");
    expect(accept).toHaveBeenCalledWith(" 7qx2k m9r4d ");
    expect(replace).toHaveBeenCalledWith(`/app/tenants/${U(7)}`);
    expect(screen.getByRole("status")).toHaveTextContent("You joined Acme Silks.");
  });
  it.each([
    [fail("invalid", "invitation_invalid"), /That code is not valid/],
    [fail("rate_limited", "invitation_locked"), /Too many wrong codes/],
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("conflict", "already_member"), /already in this business/],
  ])("a refusal (%j) is said in words and the code stays in the box", async (reply, words) => {
    window.history.replaceState(null, "", "/app/join");
    render(<JoinForm words={WORDS} accept={vi.fn(async () => reply)} />);
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "ABCDE" } });
    await press("Join");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByLabelText("Invitation code")).toHaveValue("ABCDE");
    expect(replace).not.toHaveBeenCalled();
  });
});
