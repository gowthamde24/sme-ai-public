import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { ImportResult, PreviewResult, ReadResult, SheetLink } from "@/lib/lead-desk/imports/types";

import { ImportScreen, type ImportActions } from "./ImportScreen";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("li.")));
const COUNTS = { ready: 412, duplicates_merged: 20, duplicates_in_file: 3, already_imported: 0, invalid: 9, dnd: 31, no_consent: 0, blocked: 0 };
const READ_PASTE: ReadResult = { kind: "paste", rows: 3, columns: [], fields: [], mapping: null, mapped_by: "none", needs_confirmation: false, warnings: [] };
const READ_FILE: ReadResult = {
  kind: "file", rows: 3, fields: [], mapping: { name: 0 }, mapped_by: "rules", needs_confirmation: true, warnings: ["cells_cut"],
  columns: [{ index: 0, header: "Name", samples: ["Ravi", "Anitha", "Kiran"], field: "name", confidence: "exact" }, { index: 1, header: "Mob. No.", samples: ["9000000001"], field: null, confidence: "none" }],
};
const PREVIEW: PreviewResult = { rows_read: 443, source: "pasted_list", counts: COUNTS, estimate: { messages: 96, call_minutes: 240, cost_paise: 1234, basis: "estimate" }, problems: [{ row: 12, reason: "invalid_number" }, { row: 15, reason: "real_data_gate" }], dnd_lookup: "checked" };
const RESULT: ImportResult = { import_id: "11111111-1111-4111-8111-111111111111", status: "done", source: "pasted_list", consent_id: null, counts: COUNTS, problems: [], created_at: "2026-10-26T10:00:00Z" };
const LINK: SheetLink = { id: "11111111-1111-4111-8111-111111111112", status: "active", source: "google_sheet", last_synced_at: null, last_row_count: null, last_result: null, last_error: null, created_at: "2026-10-26T10:00:00Z", next_sync_at: null };

const actions = (over: Partial<ImportActions> = {}) => ({
  read: vi.fn(async () => ({ ok: true as const, data: READ_PASTE })),
  preview: vi.fn(async () => ({ ok: true as const, data: PREVIEW })),
  import: vi.fn(async () => ({ ok: true as const, data: RESULT })),
  createLink: vi.fn(async () => ({ ok: true as const, data: LINK })),
  linkAct: vi.fn(async (_id: string, what: string) => ({ ok: true as const, data: { ...LINK, status: what === "pause" ? ("paused" as const) : ("active" as const) } })),
  ...over,
});
const draw = (a: ReturnType<typeof actions>, role: "owner" | "admin" | "sales" = "owner", sheets: { access: never; links: SheetLink[] } | null = null) =>
  render(<ImportScreen words={words} base="/app/tenants/T" role={role} test={false} fileEndpoint="/app/tenants/T/import/send" actions={a as unknown as ImportActions} sheets={sheets as never} />);
const paste = async () => {
  fireEvent.click(screen.getByRole("radio", { name: "Paste a list" }));
  fireEvent.change(screen.getByLabelText("Your list, one lead per line"), { target: { value: "Ravi, 9000000001" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read the list" })));
};

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the import screen (night 4, item 3)", () => {
  it("pasted list: read, confirm consent, check, then the plain preview line and the estimate, then add, then the two ways on", async () => {
    const a = actions();
    draw(a);
    await paste();
    expect(a.read).toHaveBeenCalledWith(expect.objectContaining({ kind: "paste", text: "Ravi, 9000000001", content_base64: null }));
    expect(screen.getByText("3 leads found.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("I confirm these people may be contacted for the reason below."));
    expect(screen.getByRole("alert")).toHaveTextContent("Fill in all four to confirm.");
    expect(screen.getByRole("button", { name: "Check the list" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name of this list"), { target: { value: "Open day" } });
    fireEvent.change(screen.getByLabelText("What you will contact them about"), { target: { value: "The new flats" } });
    fireEvent.change(screen.getByLabelText("Why you may contact them"), { target: { value: "legitimate_use" } });
    fireEvent.change(screen.getByLabelText("How you got these numbers"), { target: { value: "Form at the stall" } });
    fireEvent.change(screen.getByLabelText("Cost per lead in rupees (optional)"), { target: { value: "12.50" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the list" })));
    expect(a.preview).toHaveBeenCalledWith(expect.objectContaining({ consent_confirmed: true, source: "pasted_list" }));
    expect(screen.getByText("412 ready · 23 duplicates merged · 9 invalid · 31 on the Do-Not-Disturb list (WhatsApp only)")).toBeInTheDocument();
    expect(screen.getByText(/About 240 minutes of calls, 96 messages, ₹12/)).toBeInTheDocument();
    expect(screen.getByText(/Not a valid phone number/)).toBeInTheDocument();
    expect(screen.getAllByText(/This workspace takes made-up data only for now/).length).toBeGreaterThan(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add these leads" })));
    expect(a.import).toHaveBeenCalledWith(expect.objectContaining({ import_id: "77777777-7777-4777-8777-777777777777", cost_per_lead_paise: 1250, consent: { confirmed: true, list_name: "Open day", purpose: "The new flats", basis: "legitimate_use", how_collected: "Form at the stall" } }));
    expect(screen.getByRole("link", { name: "Start a campaign" })).toHaveAttribute("href", "/app/tenants/T/outreach/new?source=pasted_list");
    expect(screen.getByRole("link", { name: "Tell Vijaya what to do" })).toHaveAttribute("href", "/app/tenants/T/tasks?new=1");
  });

  it("a retry of the same import keeps the same id; other content gets a new one", async () => {
    let n = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `77777777-7777-4777-8777-77777777777${n++}` });
    const a = actions({ import: vi.fn().mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValue({ ok: true, data: RESULT }) });
    draw(a);
    await paste();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the list" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add these leads" })));
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work. Nothing was changed. Try again.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add these leads" })));
    const ids = (a.import as unknown as { mock: { calls: [{ import_id: string }][] } }).mock.calls.map((c) => c[0].import_id);
    expect(ids[0]).toBe(ids[1]);
  });

  it("without the confirmation, the preview is asked without it and says nothing is sent", async () => {
    const a = actions({ preview: vi.fn(async () => ({ ok: true as const, data: { ...PREVIEW, counts: { ...COUNTS, no_consent: 412 }, estimate: { messages: 0, call_minutes: 0, cost_paise: 0, basis: "estimate" as const } } })) });
    draw(a);
    await paste();
    expect(screen.getByText("Without this confirmation the leads are saved, but nothing is sent to them.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the list" })));
    expect(a.preview).toHaveBeenCalledWith(expect.objectContaining({ consent_confirmed: false }));
    expect(screen.getByText(/412 saved, nothing is sent to them \(no confirmation\)/)).toBeInTheDocument();
    expect(screen.queryByText(/About .* minutes of calls/)).toBeNull();
  });

  it("a Sales member sees why nothing is sent, has no consent box and cannot keep a sheet in sync", async () => {
    const a = actions();
    draw(a, "sales");
    await paste();
    expect(screen.getByText(/Only the Owner or an Admin can confirm this/)).toBeInTheDocument();
    expect(screen.queryByLabelText("I confirm these people may be contacted for the reason below.")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the list" })));
    expect(a.preview).toHaveBeenCalledWith(expect.objectContaining({ consent_confirmed: false }));
    cleanup();
    draw(actions(), "sales");
    fireEvent.click(screen.getByRole("radio", { name: "Google Sheet" }));
    expect(screen.getByText("Keeping a sheet in sync is for the Owner and Admin.")).toBeInTheDocument();
  });

  it("columns: each shows its header, three sample values and a select; a phone or an e-mail must be matched before going on", async () => {
    const a = actions({ read: vi.fn(async () => ({ ok: true as const, data: READ_FILE })) });
    draw(a);
    fireEvent.click(screen.getByRole("radio", { name: "Paste a list" }));
    fireEvent.click(screen.getByRole("radio", { name: "Excel or CSV file" }));
    const input = document.querySelector("#li-file") as HTMLInputElement;
    await act(async () => fireEvent.change(input, { target: { files: [new File(["Name,Mob. No.\nRavi,9000000001"], "leads.csv", { type: "text/csv" })] } }));
    await waitFor(() => expect(screen.getByText("File: leads.csv")).toBeInTheDocument());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: READ_FILE }))));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read the list" })));
    // a file goes through the route, not the server action
    expect(a.read).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/app/tenants/T/import/send/read", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("Ravi · Anitha · Kiran")).toBeInTheDocument();
    expect(screen.getByText("Very long cells were cut short.")).toBeInTheDocument();
    expect(screen.getByText("Match one column to Phone or to E-mail to go on.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the list" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("This column is: Mob. No."), { target: { value: "phone" } });
    expect(screen.queryByText("Match one column to Phone or to E-mail to go on.")).toBeNull();
    expect(screen.getByRole("button", { name: "Check the list" })).toBeEnabled();
    // a field belongs to one column only
    fireEvent.change(screen.getByLabelText("This column is: Name"), { target: { value: "phone" } });
    expect((screen.getByLabelText("This column is: Mob. No.") as HTMLSelectElement).value).toBe("");
    vi.unstubAllGlobals();
  });

  it("a file over 3 MB is refused in the browser before anything is read", async () => {
    draw(actions());
    const big = new File(["x"], "big.csv");
    Object.defineProperty(big, "size", { value: 3_000_001 });
    await act(async () => fireEvent.change(document.querySelector("#li-file") as HTMLInputElement, { target: { files: [big] } }));
    expect(screen.getByRole("alert")).toHaveTextContent("That file is over 3 MB.");
    expect(screen.getByRole("button", { name: "Read the list" })).toBeDisabled();
  });

  it("says in words why a file was refused, and that test mode reads CSV only", async () => {
    const a = actions({ read: vi.fn(async () => ({ ok: false as const, error: "sheet_refused" as const, reason: "too_many_rows" as const })) });
    draw(a);
    await paste();
    expect(screen.getByRole("alert")).toHaveTextContent("That file could not be used. The file has more than 5,000 rows.");
    cleanup();
    draw(actions({ read: vi.fn(async () => ({ ok: false as const, error: "csv_only" as const })) }));
    await paste();
    expect(screen.getByRole("alert")).toHaveTextContent("Test mode reads CSV files and pasted lists only.");
  });

  it("kept sheets: set up once the columns are confirmed, then sync now, pause and resume", async () => {
    const READ_SHEET: ReadResult = { ...READ_FILE, kind: "sheet" };
    const a = actions({ read: vi.fn(async () => ({ ok: true as const, data: READ_SHEET })) });
    const access = { modes: [{ mode: "anyone_with_link", available: true, service_account_email: null }, { mode: "published_csv", available: true, service_account_email: null }, { mode: "service_account", available: false, service_account_email: null }] };
    draw(a, "owner", { access: access as never, links: [LINK] });
    expect(screen.getByText("Sheets kept in sync")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Google Sheet" }));
    expect(screen.getByText("Sharing it with our own address: ask our team to turn it on.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Link to your Google Sheet"), { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } });
    fireEvent.click(screen.getByLabelText("Keep syncing: new rows are added every 15 minutes"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read the list" })));
    fireEvent.change(screen.getByLabelText("This column is: Mob. No."), { target: { value: "phone" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the list" })));
    expect(a.preview).toHaveBeenCalledWith(expect.objectContaining({ source: "google_sheet" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep this sheet in sync" })));
    expect(a.createLink).toHaveBeenCalledWith(expect.objectContaining({ sheet_url: "https://docs.google.com/spreadsheets/d/abc/edit", mapping: { name: 0, phone: 1 }, link_id: "77777777-7777-4777-8777-777777777777" }));
    expect(screen.getByText("The sheet is now kept in sync. New rows are added every 15 minutes.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Sync now" })[0]));
    expect(a.linkAct).toHaveBeenCalledWith(LINK.id, "sync");
    expect(screen.getByText("Queued. It is pulled within a minute.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]));
    expect(a.linkAct).toHaveBeenCalledWith(LINK.id, "pause");
    expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(1);
  });

  it("test mode says nothing is sent", () => {
    render(<ImportScreen words={words} base="/app/tenants/T" role="owner" test fileEndpoint="/x" actions={actions() as unknown as ImportActions} sheets={null} />);
    expect(screen.getByRole("note")).toHaveTextContent("Test mode: your leads stay in this browser and nothing is sent to anyone.");
  });
});
