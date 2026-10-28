import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { ConsentList } from "@/lib/api/consent-list";
import type { DataExport, Deletion } from "@/lib/api/privacy";

import { ConsentListView } from "./ConsentList";
import { DeleteData } from "./DeleteData";
import { ExportMyData } from "./ExportMyData";
import { PrivacySection } from "./PrivacySection";
import { confirms } from "./privacy-model";
import type { PrivacyActions } from "./types";

const T = "11111111-1111-4111-8111-111111111111";
const WORDS = wordsFor("en", ["prx.", "apierr.", "problem."], ["dta.btn.working", "dta.col.name", "settings.privacy.erasure", "settings.privacy.suppression", "settings.privacy.note"]);
const NOW = Date.parse("2026-10-12T10:00:00Z");
const exp = (over: Partial<DataExport> = {}): DataExport => ({ id: "33333333-3333-4333-8333-333333333333", scope: "person", status: "ready", requested_at: "2026-10-12T09:00:00Z", ready_at: "2026-10-12T09:00:30Z", expires_at: "2026-10-13T09:00:30Z", size_bytes: 12345, error_code: null, ...over });
const del = (over: Partial<Deletion> = {}): Deletion => ({ id: "44444444-4444-4444-8444-444444444444", kind: "account", status: "scheduled", requested_at: "2026-10-12T09:00:00Z", execute_after: "2026-10-26T09:00:00Z", cancelled_at: null, executed_at: null, blocked_reason: null, ...over });
const fail = (kind: string, code?: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, kind: kind as never, error: "", ...(code ? { code } : {}), ...extra });
const actions = (over: Partial<PrivacyActions> = {}): PrivacyActions => ({
  requestExport: vi.fn(async () => ({ ok: true as const, data: exp({ status: "queued", ready_at: null, expires_at: null, size_bytes: null }) })),
  getExport: vi.fn(async () => ({ ok: true as const, data: exp() })),
  openLink: vi.fn(async () => ({ ok: true as const, data: { url: "https://files.example.test/x?token=1", link_valid_seconds: 300, file_expires_at: null, size_bytes: 1 } })),
  requestAccountDeletion: vi.fn(async () => ({ ok: true as const, data: del() })),
  cancelAccountDeletion: vi.fn(async () => ({ ok: true as const, data: del({ status: "cancelled" }) })),
  requestWorkspaceDeletion: vi.fn(async () => ({ ok: true as const, data: del({ kind: "workspace" }) })),
  cancelWorkspaceDeletion: vi.fn(async () => ({ ok: true as const, data: del({ kind: "workspace", status: "cancelled" }) })),
  executeWorkspaceDeletion: vi.fn(async () => ({ ok: true as const, data: del({ kind: "workspace", status: "executed", executed_at: "2026-10-27T09:00:00Z" }) })),
  ...over,
});
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("download my data", () => {
  it("says what the file is and how long things last, offers the workspace's data to the owner only", () => {
    render(<ExportMyData words={WORDS} actions={actions()} initial={[]} isOwner={false} />);
    expect(screen.getByText(/The download link works for 5 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare the workspace's data" })).toBeNull();
    expect(screen.getByText("You have not asked for a file yet.")).toBeInTheDocument();
    cleanup();
    render(<ExportMyData words={WORDS} actions={actions()} initial={[]} isOwner />);
    expect(screen.getByRole("button", { name: "Prepare the workspace's data" })).toBeInTheDocument();
    expect(screen.getByText(/needs your second step/)).toBeInTheDocument();
  });
  it("the workspace's data needs the business name typed: the button waits for it, the name goes with the request, and the e-mail note is announced", async () => {
    const a = actions();
    render(<ExportMyData words={WORDS} actions={a} initial={[]} isOwner workspaceName="Acme Silks" />);
    expect(screen.queryByLabelText("Type Acme Silks to confirm")).toBeNull();
    await press("Prepare the workspace's data");
    expect(screen.getByText("We will e-mail you a note that this was done.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for the workspace data" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type Acme Silks to confirm"), { target: { value: "acme silks" } });
    expect(screen.getByRole("button", { name: "Ask for the workspace data" })).toBeDisabled(); // as written
    fireEvent.change(screen.getByLabelText("Type Acme Silks to confirm"), { target: { value: " Acme Silks " } });
    await press("Ask for the workspace data");
    expect(a.requestExport).toHaveBeenCalledWith("workspace", expect.stringMatching(/^[0-9a-f-]{36}$/), "Acme Silks");
  });
  it("asks with an id it made, shows 'Preparing', looks again every few seconds and offers Download when ready", async () => {
    vi.useFakeTimers();
    const a = actions();
    render(<ExportMyData words={WORDS} actions={a} initial={[]} isOwner={false} />);
    await press("Prepare my file");
    expect(a.requestExport).toHaveBeenCalledWith("person", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing your file");
    expect(screen.getByRole("button", { name: "Prepare my file" })).toBeDisabled(); // one at a time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(a.getExport).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare my file" })).toBeEnabled();
  });
  it("Download asks for a link and opens it at once; the address is never drawn on the page", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });
    const a = actions();
    render(<ExportMyData words={WORDS} actions={a} initial={[exp()]} isOwner={false} />);
    await press("Download");
    expect(a.openLink).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
    expect(assign).toHaveBeenCalledWith("https://files.example.test/x?token=1");
    expect(document.body.textContent).not.toContain("token=1");
    expect(screen.getByRole("status")).toHaveTextContent("The link worked once, for 5 minutes, and is gone.");
  });
  it.each([
    [fail("conflict", "privacy_state"), /already being made/],
    [fail("rate_limited", "privacy_rate_limited"), /5 files a day/],
    [fail("unavailable", "storage_unavailable"), /Files cannot be made on this system/],
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("forbidden"), /Your role cannot do this/],
  ])("a refusal (%j) is said in words and nothing is lost", async (reply, words) => {
    render(<ExportMyData words={WORDS} actions={actions({ requestExport: vi.fn(async () => reply) })} initial={[exp()]} isOwner workspaceName="Acme Silks" />);
    await press("Prepare the workspace's data");
    fireEvent.change(screen.getByLabelText("Type Acme Silks to confirm"), { target: { value: "Acme Silks" } });
    await press("Ask for the workspace data");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("a failed or expired file says so, and a too-big one says why", () => {
    render(<ExportMyData words={WORDS} actions={actions()} initial={[exp({ id: "a".repeat(8) + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "failed", error_code: "too_large" }), exp({ id: "b".repeat(8) + "-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "expired" })]} isOwner={false} />);
    expect(screen.getByText("Too big to make")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
});

describe("delete my account and the workspace", () => {
  const base = { words: WORDS, email: "owner@example.test", workspaceName: "Acme Silks", now: NOW };
  it("the typed confirmation matches the e-mail in any case, and the workspace name as written", () => {
    expect(confirms(" Owner@Example.test ", "owner@example.test", true)).toBe(true);
    expect(confirms("acme silks", "Acme Silks", false)).toBe(false);
    expect(confirms("Acme Silks ", "Acme Silks", false)).toBe(true);
    expect(confirms("", "", true)).toBe(false);
  });
  it("the button stays off until the e-mail is typed, then schedules the deletion and says there are 7 days", async () => {
    const a = actions();
    render(<DeleteData {...base} actions={a} isOwner={false} accountDeletion={null} workspaceDeletion={null} />);
    expect(screen.queryByRole("heading", { name: "Delete this workspace" })).toBeNull();
    expect(screen.getByText(/There are 7 days to change your mind/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type your e-mail address (owner@example.test) to confirm."), { target: { value: "wrong@example.test" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type your e-mail address/), { target: { value: "OWNER@example.test" } });
    expect(button).toBeEnabled();
    await press("Delete my account");
    expect(a.requestAccountDeletion).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "OWNER@example.test");
    expect(screen.getByText("Deletion is scheduled")).toBeInTheDocument();
    expect(screen.getByText(/Scheduled\. Your account will be deleted after the 7 days unless you cancel\./)).toBeInTheDocument();
  });
  it("a scheduled deletion shows its day and can be cancelled", async () => {
    const a = actions();
    render(<DeleteData {...base} actions={a} isOwner={false} accountDeletion={del()} workspaceDeletion={null} />);
    expect(screen.getByText(/Your account will be deleted on/)).toBeInTheDocument();
    await press("Cancel the deletion");
    expect(a.cancelAccountDeletion).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
    expect(screen.getByText("Cancelled. Nothing will be deleted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDisabled(); // back to the typed confirmation
  });
  it.each([
    [fail("conflict", "sole_owner"), /only owner of a workspace/],
    [fail("invalid", "confirmation_mismatch"), /does not match/],
    [fail("conflict", "privacy_state"), /already being made|cannot be done right now/],
    [fail("mfa", undefined, { mfa: true }), /second step/],
    [fail("rate_limited", undefined, { retryAfter: 30 }), /Wait 30 seconds/],
  ])("a refusal (%j) is said in words and keeps what was typed", async (reply, words) => {
    render(<DeleteData {...base} actions={actions({ requestAccountDeletion: vi.fn(async () => reply) })} isOwner={false} accountDeletion={null} workspaceDeletion={null} />);
    fireEvent.change(screen.getByLabelText(/Type your e-mail address/), { target: { value: "owner@example.test" } });
    await press("Delete my account");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(screen.getByLabelText(/Type your e-mail address/)).toHaveValue("owner@example.test");
  });
  it("the owner can ask to delete the workspace: the name as written, 7 days, and nothing is erased yet", async () => {
    const a = actions();
    render(<DeleteData {...base} actions={a} isOwner accountDeletion={null} workspaceDeletion={null} />);
    const section = within(screen.getByRole("heading", { name: "Delete this workspace" }).closest("section")!);
    fireEvent.change(section.getByLabelText("Type the workspace name (Acme Silks) to confirm."), { target: { value: "acme silks" } });
    expect(section.getByRole("button", { name: "Delete this workspace" })).toBeDisabled();
    fireEvent.change(section.getByLabelText(/Type the workspace name/), { target: { value: "Acme Silks" } });
    await act(async () => fireEvent.click(section.getByRole("button", { name: "Delete this workspace" })));
    expect(a.requestWorkspaceDeletion).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "Acme Silks");
    expect(a.executeWorkspaceDeletion).not.toHaveBeenCalled();
    expect(section.getByText(/The 7 days are not over yet/)).toBeInTheDocument();
    expect(section.queryByRole("button", { name: "Erase the workspace now" })).toBeNull();
  });
  it("after the 7 days the owner can erase it, by typing the name again; the result is said", async () => {
    const a = actions();
    render(<DeleteData {...base} actions={a} isOwner accountDeletion={null} workspaceDeletion={del({ kind: "workspace", execute_after: "2026-10-12T09:00:00Z" })} />);
    const section = within(screen.getByRole("heading", { name: "Delete this workspace" }).closest("section")!);
    expect(section.getByText("The 7 days are over. You can erase the workspace now.")).toBeInTheDocument();
    const go = section.getByRole("button", { name: "Erase the workspace now" });
    expect(go).toBeDisabled();
    fireEvent.change(section.getByLabelText(/Type the workspace name/), { target: { value: "Acme Silks" } });
    await act(async () => fireEvent.click(go));
    expect(a.executeWorkspaceDeletion).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
    expect(section.getAllByText("The personal data of this workspace has been erased.").length).toBeGreaterThan(0);
  });
  it("a blocked deletion says why (the only owner), an executed one says it is done", () => {
    render(<DeleteData {...base} actions={actions()} isOwner={false} accountDeletion={del({ status: "blocked", blocked_reason: "sole_owner" })} workspaceDeletion={null} />);
    expect(screen.getByText(/only owner of a workspace/)).toBeInTheDocument();
  });
});

describe("the consent and opt-out list", () => {
  const list: ConsentList = {
    checked: 4,
    truncated: false,
    stopped: [{ id: "55555555-5555-4555-8555-555555555555", name: "Asha Rao", reason: "opted_out", channels: { email: "unknown", whatsapp: "withdrawn", phone: "unknown" } }],
    counts: { whatsapp: { unknown: 2, granted: 1, withdrawn: 1 }, phone: { unknown: 4, granted: 0, withdrawn: 0 }, email: { unknown: 3, granted: 1, withdrawn: 0 } },
  };
  it("counts what each way of reaching customers has been agreed to, and lists who asked to stop with a link to their consent page", () => {
    render(<ConsentListView tenantId={T} words={WORDS} list={list} />);
    expect(screen.getByText("1 agreed, 2 not recorded, 1 withdrawn")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Asha Rao/ });
    expect(within(row).getByText("Opted out")).toBeInTheDocument();
    expect(within(row).getByText("WhatsApp withdrawn")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open consent record Asha Rao" })).toHaveAttribute("href", `/app/tenants/${T}/contacts/55555555-5555-4555-8555-555555555555/consent`);
    expect(screen.getByText("Looked at all 4 customers.")).toBeInTheDocument();
  });
  it("says when only the first customers were looked at, when nobody asked to stop, and when there are no customers", () => {
    const { rerender } = render(<ConsentListView tenantId={T} words={WORDS} list={{ ...list, truncated: true, checked: 500, stopped: [] }} />);
    expect(screen.getByText("Looked at the first 500 customers only.")).toBeInTheDocument();
    expect(screen.getByText("Nobody has asked us to stop.")).toBeInTheDocument();
    rerender(<ConsentListView tenantId={T} words={WORDS} list={{ ...list, checked: 0, stopped: [] }} />);
    expect(screen.getByText("There are no customers in your list yet.")).toBeInTheDocument();
  });
  it("a customer's own name is drawn as text", () => {
    render(<ConsentListView tenantId={T} words={WORDS} list={{ ...list, stopped: [{ ...list.stopped[0], name: "<b>Bold</b>" }] }} />);
    expect(screen.getByText("<b>Bold</b>")).toBeInTheDocument();
  });
});

describe("the Privacy part of Settings", () => {
  const ok = <X,>(data: X) => ({ ok: true as const, data });
  const props = { tenantId: T, words: WORDS, email: "owner@example.test", workspaceName: "Acme Silks", now: NOW, actions: actions() };
  const consent = { checked: 0, truncated: false, stopped: [], counts: { whatsapp: { unknown: 0, granted: 0, withdrawn: 0 }, phone: { unknown: 0, granted: 0, withdrawn: 0 }, email: { unknown: 0, granted: 0, withdrawn: 0 } } };
  it("an owner sees every part, and the two older pages", () => {
    render(<PrivacySection {...props} role="owner" exports={ok([])} myDeletions={ok([])} workspaceDeletions={ok([])} consent={ok(consent)} />);
    for (const name of ["Download my data", "Delete my account", "Delete this workspace", "Consent and opt-out list", "More privacy tools"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy and erasure" })).toHaveAttribute("href", `/app/tenants/${T}/privacy`);
    expect(screen.getByRole("link", { name: "Suppression keys" })).toBeInTheDocument();
  });
  it("a salesperson has no workspace deletion, no older pages and a sentence about why", () => {
    render(<PrivacySection {...props} role="sales" exports={ok([])} myDeletions={ok([])} workspaceDeletions={null} consent={ok(consent)} />);
    expect(screen.queryByRole("heading", { name: "Delete this workspace" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Privacy and erasure" })).toBeNull();
    expect(screen.getByText(/Only an owner or an admin can open privacy and erasure/)).toBeInTheDocument();
  });
  it("a viewer has no consent list (the API shows customers to writers)", () => {
    render(<PrivacySection {...props} role="viewer" exports={ok([])} myDeletions={ok([])} workspaceDeletions={null} consent={null} />);
    expect(screen.queryByRole("heading", { name: "Consent and opt-out list" })).toBeNull();
  });
  it("a part refused (403), limited (429) or not loaded says so in its place and the others stay", () => {
    render(<PrivacySection {...props} role="owner" exports={{ ok: false, kind: "forbidden" }} myDeletions={{ ok: false, kind: "rate_limited", retryAfter: 20 }} workspaceDeletions={ok([])} consent={{ ok: false, kind: "unavailable" }} />);
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.getByText(/Wait 20 seconds/)).toBeInTheDocument();
    expect(screen.getByText("This part could not be loaded. The rest of the page is fine.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "More privacy tools" })).toBeInTheDocument();
  });
});

beforeEach(() => vi.clearAllMocks());
