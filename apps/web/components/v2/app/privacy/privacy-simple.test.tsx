import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { Consents, MarketingResult } from "@/lib/dpdp/types";
import type { DataExport, Deletion } from "@/lib/api/privacy";

import { DeleteData } from "./DeleteData";
import { ExportMyData } from "./ExportMyData";
import { MarketingSwitch } from "./MarketingSwitch";
import { PrivacySection } from "./PrivacySection";
import type { PrivacyActions } from "./types";

// the same privacy words as the Settings page draws under JOBS (the prefixes of the page), plus the JOBS layout words
const WORDS = wordsFor("en", ["prx.", "apierr.", "problem.", "dpdp.", "jobs.set.b."], ["dta.btn.working", "dta.col.name", "settings.privacy.erasure", "settings.privacy.suppression", "settings.privacy.note"]);
const NOW = Date.parse("2026-10-12T10:00:00Z");
const exp = (over: Partial<DataExport> = {}): DataExport => ({ id: "33333333-3333-4333-8333-333333333333", scope: "person", status: "ready", requested_at: "2026-10-12T09:00:00Z", ready_at: "2026-10-12T09:00:30Z", expires_at: "2026-10-13T09:00:30Z", size_bytes: 12345, error_code: null, ...over });
const del = (over: Partial<Deletion> = {}): Deletion => ({ id: "44444444-4444-4444-8444-444444444444", kind: "account", status: "scheduled", requested_at: "2026-10-12T09:00:00Z", execute_after: "2026-10-26T09:00:00Z", cancelled_at: null, executed_at: null, blocked_reason: null, ...over });
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
afterEach(cleanup);

describe("Settings > Privacy and data under JOBS: download my data", () => {
  it("one button for my file; the whole workspace's data is under More choices (owner), with the same typed confirmation and request", async () => {
    const a = actions();
    render(<ExportMyData words={WORDS} actions={a} initial={[exp()]} isOwner workspaceName="Acme Silks" simple />);
    const card = document.querySelector('[data-privacy="export"]') as HTMLElement;
    expect(card).toHaveAttribute("data-simple");
    expect(within(card).getByText("Ready", { selector: ".jb-chip" })).toHaveAttribute("data-tone", "done");
    const more = card.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByRole("button", { name: "Prepare the workspace's data" })).toBeInTheDocument();
    expect([...card.querySelectorAll("button")].filter((b) => !b.closest("details") && /Prepare/.test(b.textContent ?? ""))).toHaveLength(1);
    await press("Prepare the workspace's data");
    fireEvent.change(screen.getByLabelText("Type Acme Silks to confirm"), { target: { value: " Acme Silks " } });
    await press("Ask for the workspace data");
    expect(a.requestExport).toHaveBeenCalledWith("workspace", expect.stringMatching(/^[0-9a-f-]{36}$/), "Acme Silks");
  });
  it("my file is asked for with the same call, and anybody but the owner has no More choices here", async () => {
    const a = actions();
    render(<ExportMyData words={WORDS} actions={a} initial={[]} isOwner={false} simple />);
    expect(document.querySelector('[data-part="more-choices"]')).toBeNull();
    await press("Prepare my file");
    expect(a.requestExport).toHaveBeenCalledWith("person", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(screen.getByText("Waiting", { selector: ".jb-chip" })).toHaveAttribute("data-tone", "info");
  });
});

describe("Settings > Privacy and data under JOBS: delete", () => {
  it("my account is in view with the typed confirmation; the workspace (owner) is under More choices; the same calls", async () => {
    const a = actions();
    render(<DeleteData words={WORDS} actions={a} email="ravi@example.test" workspaceName="Acme Silks" isOwner accountDeletion={null} workspaceDeletion={null} now={NOW} simple />);
    const root = document.querySelector('[data-privacy="delete"]') as HTMLElement;
    const more = root.querySelector('[data-part="more-choices"]') as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(more.querySelector('[data-privacy="delete-workspace"]')).not.toBeNull();
    expect(root.querySelector('[data-privacy="delete-account"]')!.closest("details")).toBeNull();
    const button = screen.getAllByRole("button", { name: "Delete my account" })[0];
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type your e-mail address (ravi@example.test) to confirm."), { target: { value: "RAVI@example.test" } });
    await act(async () => fireEvent.click(button));
    expect(a.requestAccountDeletion).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/), "RAVI@example.test");
    expect(await screen.findByText(/Scheduled\. Your account will be deleted after the 7 days/)).toBeInTheDocument();
  });
  it("a scheduled deletion keeps its Cancel; an admin has no workspace deletion at all", async () => {
    const a = actions();
    render(<DeleteData words={WORDS} actions={a} email="ravi@example.test" workspaceName="Acme Silks" isOwner={false} accountDeletion={del()} workspaceDeletion={null} now={NOW} simple />);
    expect(document.querySelector('[data-part="more-choices"]')).toBeNull();
    await press("Cancel the deletion");
    expect(a.cancelAccountDeletion).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
  });
});

const consents = (state: Consents["marketing"]["state"]): Consents => ({ noticeVersion: "2026-10-27", marketing: { state, since: state === "not_given" ? null : "2026-10-20T05:00:00Z" }, history: state === "not_given" ? [] : [{ action: "given", at: "2026-10-20T05:00:00Z", via: "settings", noticeVersion: "2026-10-27" }] });
describe("Settings > Privacy and data under JOBS: news and offers", () => {
  it("is one round tick, off until the person turns it on, and the same action runs; the earlier choices are under More choices", async () => {
    const action = vi.fn(async (given: boolean): Promise<MarketingResult> => ({ ok: true, consents: consents(given ? "given" : "withdrawn") }));
    render(<MarketingSwitch words={WORDS} lang="en" initial={consents("not_given")} action={action} simple />);
    const tick = screen.getByRole("checkbox", { name: /news and offers/i });
    expect(tick).not.toBeChecked();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(tick);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /news and offers/i })).toBeChecked());
    expect(action).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Switched on. We may send you news and offers.")).toBeInTheDocument();
    expect(document.querySelector('[data-part="more-choices"]')).toHaveTextContent("20 Oct 2026: Said yes (in Settings)");
  });
  it("a failed change leaves the tick where it was and says nothing was changed", async () => {
    render(<MarketingSwitch words={WORDS} lang="en" initial={consents("given")} action={vi.fn(async () => ({ ok: false as const, error: "down" as const }))} simple />);
    fireEvent.click(screen.getByRole("checkbox", { name: /news and offers/i }));
    expect(await screen.findByText("That did not save. Nothing was changed. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /news and offers/i })).toBeChecked();
  });
});

describe("Settings > Privacy and data under JOBS: the section", () => {
  const dpdp = { consents: consents("not_given"), setMarketing: vi.fn(), grievance: vi.fn(), days: 15, privacyEmail: "privacy@example.test", name: "Ravi" };
  const draw = (simple: boolean, role = "owner") =>
    render(
      <PrivacySection
        tenantId="11111111-1111-4111-8111-111111111111"
        words={WORDS}
        role={role}
        email="ravi@example.test"
        workspaceName="Acme Silks"
        exports={{ ok: true, data: [] }}
        myDeletions={{ ok: true, data: [] }}
        workspaceDeletions={role === "owner" ? { ok: true, data: [] } : null}
        consent={{ ok: true, data: { checked: 0, truncated: false, counts: { whatsapp: { granted: 0, unknown: 0, withdrawn: 0 }, sms: { granted: 0, unknown: 0, withdrawn: 0 }, email: { granted: 0, unknown: 0, withdrawn: 0 } }, stopped: [] } as never }}
        actions={actions()}
        now={NOW}
        dpdp={dpdp}
        simple={simple}
      />,
    );
  it("keeps every part and every sentence: download, news and offers, delete, the grievance form, the consent list and the older pages; the last two sit under More choices", () => {
    draw(true);
    const root = document.querySelector('[data-settings="privacy"]') as HTMLElement;
    expect(root).toHaveAttribute("data-simple");
    for (const h of ["Download my data", "News and offers", "Delete my account", "Raise a grievance"]) expect(within(root).getByRole("heading", { name: h })).toBeInTheDocument();
    const more = [...root.querySelectorAll('[data-part="more-choices"]')].find((d) => /More privacy tools/.test(d.textContent ?? "")) as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByRole("heading", { name: "Consent and opt-out list" })).toBeInTheDocument();
    expect(within(more).getByRole("link", { name: "Privacy and erasure" })).toHaveAttribute("href", "/app/tenants/11111111-1111-4111-8111-111111111111/privacy");
    expect(within(more).getByRole("link", { name: "Suppression keys" })).toBeInTheDocument();
    expect(root.textContent).toContain("A zip file with each table as JSON and CSV");
  });
  it("JOBS off draws the page of before (no More choices, the switch of before)", () => {
    draw(false);
    const root = document.querySelector('[data-settings="privacy"]') as HTMLElement;
    expect(root).not.toHaveAttribute("data-simple");
    expect(root.querySelector('[data-part="more-choices"]')).toBeNull();
    expect(screen.getByRole("switch", { name: /news and offers/i })).toBeInTheDocument();
  });
  it("an admin has no workspace data or deletion and no suppression keys", () => {
    draw(true, "admin");
    expect(screen.queryByRole("button", { name: "Prepare the workspace's data" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Suppression keys" })).toBeNull();
    expect(screen.getByRole("link", { name: "Privacy and erasure" })).toBeInTheDocument();
  });
});
