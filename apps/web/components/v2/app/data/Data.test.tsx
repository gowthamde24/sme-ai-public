import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";

import { CalendarFeed } from "./CalendarFeed";
import { DataExport } from "./DataExport";
import { DataImport } from "./DataImport";
import { DataSection } from "./DataSection";
import { chooseColumn, fileProblem, importSentence, initialChoices, mappingToSend } from "./import-model";
import { fallbackName, lastMonth, rangeProblem } from "./export-model";
import { makeT } from "../words";

const T = "11111111-1111-4111-8111-111111111111";
const JOB = "33333333-3333-4333-8333-333333333333";
const WORDS = wordsFor("en", ["dta.", "apierr.", "problem.", "catalogue.stock."]);
const t = makeT(WORDS);
afterEach(cleanup);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const INSPECT = {
  kind: "customers",
  file_kind: "csv",
  rows: 2,
  columns: [
    { index: 0, header: "Party Name", suggested_field: "company_name", confidence: "exact" },
    { index: 1, header: "Mobile", suggested_field: "contact_phone", confidence: "partial" },
    { index: 2, header: "Town", suggested_field: "city", confidence: "weak" },
  ],
  suggested_mapping: { company_name: 0, contact_phone: 1, city: 2 },
  fields: [
    { field: "company_name", label: "Customer or shop name", required: true },
    { field: "contact_phone", label: "Phone or WhatsApp number", required: false },
    { field: "city", label: "City", required: false },
  ],
  sample: [["Ravi Silks", "98765 43210", "Guntur"]],
  cut_cells: 0,
};
const PREVIEW = {
  job_id: JOB,
  counts: { rows: 2, usable: 2, will_create: 1, duplicate: 1, needs_review: 0, rejected: 0, file_problems: 1 },
  rows: [
    { line: 2, status: "will_create", reason: null, label: "Ravi Silks", city: "Guntur", note: "contact_needs_phone_or_email", old_status: null, new_status: null },
    { line: 3, status: "rejected", reason: "contact_domain_not_reserved", label: "Real Shop", city: null, note: null, old_status: null, new_status: null },
  ],
  issues: [{ line: 3, code: "formula_cell", field: "city" }],
  mapping: { company_name: 0, contact_phone: 1, city: 2 },
};
const DONE = { job: { id: JOB, kind: "customers", status: "completed", counts: {}, created_at: null, completed_at: null }, replay: false, result: { counts: { created: 1, skipped_duplicate: 1, companies_created: 1, contacts_created: 0 }, rows: [{ ...PREVIEW.rows[0], status: "created" }], issues: [] } };

function mockRoutes(handlers: Record<string, () => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const key = Object.keys(handlers).find((k) => String(url).includes(k));
    return key ? handlers[key]() : json({ ok: false, kind: "other", error: "" }, 500);
  }) as unknown as typeof fetch;
  return calls;
}
const pickFile = (name = "parties.csv", content = "Party Name,Mobile,Town\nRavi Silks,98765 43210,Guntur") => {
  const input = screen.getByLabelText("Choose the file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], name, { type: "text/csv" })] } });
};
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

describe("the import: a file, the columns, the preview, then the import", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says where to get a file from Tally or Vyapar, and that nothing connects to them", () => {
    render(<DataImport tenantId={T} words={WORDS} />);
    expect(screen.getByRole("radio", { name: "Excel or Google Sheets" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Tally" }));
    expect(screen.getByText(/we do not connect to Tally/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Vyapar" }));
    expect(screen.getByText(/we do not connect to Vyapar/)).toBeInTheDocument();
  });

  it("goes through every step with the same file, sends the chosen columns, and shows what happened", async () => {
    const calls = mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }), "/import/preview": () => json({ ok: true, data: PREVIEW }), "/import/confirm": () => json({ ok: true, data: DONE }) });
    render(<DataImport tenantId={T} words={WORDS} />);
    fireEvent.click(screen.getByRole("radio", { name: "Saree stock" }));
    fireEvent.click(screen.getByRole("radio", { name: "Customers" }));
    pickFile();
    expect(screen.getByText(/parties\.csv/)).toBeInTheDocument();
    await press("Check the file");
    expect(calls[0].url).toBe(`/app/tenants/${T}/data/import/inspect?kind=customers`);
    expect((calls[0].init.body as File).name).toBe("parties.csv");

    // the mapping step: the API's guess is filled in, with how sure it is
    expect(screen.getByRole("heading", { name: "Which column is which?" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Customer or shop name/)).toHaveValue("0");
    expect(screen.getByText("sure")).toBeInTheDocument();
    expect(screen.getByText("a guess")).toBeInTheDocument();
    expect(screen.getByText("A customer needs a name and a phone number or an e-mail. A phone number alone is fine.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Party Name" })).toBeInTheDocument();
    expect(screen.getByText("Ravi Silks")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "" } });

    await press("Show what would happen");
    const url = new URL(`https://x${calls[1].url}`);
    expect(url.pathname).toBe(`/app/tenants/${T}/data/import/preview`);
    expect(url.searchParams.get("kind")).toBe("customers");
    expect(url.searchParams.get("job_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(url.searchParams.get("mapping") ?? "")).toEqual({ company_name: 0, contact_phone: 1 });
    expect((calls[1].init.body as File).name).toBe("parties.csv");

    // the preview: figures, the problems of the file, every row with its verdict and its reason in words
    expect(screen.getByRole("heading", { name: "What would happen" })).toBeInTheDocument();
    expect(screen.getByText("Nothing is saved yet. Look at the rows, then press Import.")).toBeInTheDocument();
    const rows = within(screen.getByRole("table"));
    expect(rows.getByText("Would be added")).toBeInTheDocument();
    expect(rows.getByText("No phone number or e-mail: the shop is added without a person.")).toBeInTheDocument();
    expect(rows.getByText(/looks real\. Until real customer details are allowed/)).toBeInTheDocument();
    expect(screen.getByText("Line 3: A cell holds a formula. Formulas are not read.")).toBeInTheDocument();
    expect(screen.getByText(/Importing needs your second step/)).toBeInTheDocument();

    await press("Import");
    expect(calls[2].url).toBe(`/app/tenants/${T}/data/import/confirm?job_id=${JOB}`);
    expect((calls[2].init.body as File).name).toBe("parties.csv"); // the SAME file again
    expect(screen.getByRole("status")).toHaveTextContent("Import finished");
    expect(screen.getByText("Already there, left as it was")).toBeInTheDocument();
    await press("Import another file");
    expect(screen.getByLabelText("Choose the file")).toBeInTheDocument();
  });

  it("will not ask for a preview until the required column is chosen, and says which", async () => {
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: { ...INSPECT, suggested_mapping: {} } }) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    await press("Show what would happen");
    expect(screen.getByRole("alert")).toHaveTextContent('Choose a column for "Customer or shop name" first.');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("a column can serve one field only: choosing it again clears the earlier field", async () => {
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "0" } });
    expect(screen.getByLabelText(/Customer or shop name/)).toHaveValue("");
  });

  it("checks the file before sending it: empty, over 2 MB, a CSV over 1 MB", () => {
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile("empty.csv", "");
    expect(screen.getByRole("alert")).toHaveTextContent("That file is empty.");
    expect(screen.getByRole("button", { name: "Check the file" })).toBeDisabled();
    expect(fileProblem({ name: "a.xlsx", size: 2_000_001 }, t)).toBe("That file is over 2 MB. Choose a smaller one or split it.");
    expect(fileProblem({ name: "a.csv", size: 1_000_001 }, t)).toMatch(/CSV over 1 MB/);
    expect(fileProblem({ name: "a.xlsx", size: 1_500_000 }, t)).toBeNull();
  });

  it.each([
    [{ ok: false, kind: "mfa", error: "This needs your second step. Open Security, enter your authenticator code, then try again.", mfa: true }, 403, "second step", true],
    [{ ok: false, kind: "rate_limited", error: "", retryAfter: 20 }, 429, "Wait 20 seconds", false],
    [{ ok: false, kind: "forbidden", error: "" }, 403, "Your role cannot do this", false],
    [{ ok: false, kind: "invalid", error: "", code: "file_encrypted" }, 422, "password protected", false],
    [{ ok: false, kind: "invalid", error: "", code: "file_not_xlsx" }, 415, "not a CSV or an Excel", false],
    [{ ok: false, kind: "conflict", error: "", code: "import_file_changed" }, 409, "not the file that was checked", false],
    [{ ok: false, kind: "unavailable", error: "" }, 503, "could not reach the service", false],
  ])("a refusal at the first step (%j) is said in words and keeps the file", async (body, status, words, security) => {
    mockRoutes({ "/import/inspect": () => json(body, status) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(words, "i"));
    expect(!!screen.queryByRole("link", { name: "Open Security" })).toBe(security);
    expect(screen.getByRole("button", { name: "Check the file" })).toBeEnabled();
    expect(screen.getByText(/parties\.csv/)).toBeInTheDocument();
  });

  it("a refusal of the import itself (no second step) keeps the preview, so nothing is lost", async () => {
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }), "/import/preview": () => json({ ok: true, data: PREVIEW }), "/import/confirm": () => json({ ok: false, kind: "mfa", error: "", mfa: true }, 403) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    await press("Show what would happen");
    await press("Import");
    expect(screen.getByRole("alert")).toHaveTextContent(/second step/);
    expect(screen.getByRole("link", { name: "Open Security" })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("heading", { name: "What would happen" })).toBeInTheDocument();
  });

  it("a file already imported says nothing was imported twice", async () => {
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }), "/import/preview": () => json({ ok: true, data: PREVIEW }), "/import/confirm": () => json({ ok: true, data: { ...DONE, replay: true, result: null } }) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    await press("Show what would happen");
    await press("Import");
    expect(screen.getByRole("status")).toHaveTextContent("This file was already imported. Nothing was imported twice.");
  });

  it("nothing to import: the Import button stays off", async () => {
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }), "/import/preview": () => json({ ok: true, data: { ...PREVIEW, counts: { ...PREVIEW.counts, will_create: 0 }, rows: [] } }) });
    render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    await press("Show what would happen");
    expect(screen.getByText("There are no usable rows in this file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("a customer's own words are drawn as text, never as markup", async () => {
    const evil = { ...PREVIEW, rows: [{ ...PREVIEW.rows[0], label: '<img src=x onerror="alert(1)">' }] };
    mockRoutes({ "/import/inspect": () => json({ ok: true, data: INSPECT }), "/import/preview": () => json({ ok: true, data: evil }) });
    const { container } = render(<DataImport tenantId={T} words={WORDS} />);
    pickFile();
    await press("Check the file");
    await press("Show what would happen");
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("import model", () => {
  it("fills the choices from the guess, and only sends fields that have a column", () => {
    const fields = INSPECT.fields;
    expect(initialChoices(fields, { company_name: 0 })).toEqual({ company_name: "0", contact_phone: "", city: "" });
    expect(mappingToSend(fields, { company_name: "0", contact_phone: "", city: "2" })).toEqual({ mapping: { company_name: 0, city: 2 }, missing: null });
    expect(mappingToSend(fields, { company_name: "", contact_phone: "1", city: "" })).toEqual({ mapping: { contact_phone: 1 }, missing: "company_name" });
    expect(chooseColumn({ a: "1", b: "2" }, "b", "1")).toEqual({ a: "", b: "1" });
    expect(chooseColumn({ a: "1", b: "2" }, "b", "")).toEqual({ a: "1", b: "" });
  });
  it("has a sentence for every file refusal the API has, and none for a code it does not know", () => {
    for (const c of ["empty", "too_large", "not_utf8", "malformed_csv", "too_many_rows", "too_many_columns", "no_header", "not_xlsx", "too_many_parts", "encrypted", "unsafe_xml", "unreadable", "no_sheet"]) expect(importSentence(`file_${c}`, t), c).toMatch(/\.$/);
    expect(importSentence("file_something_new", t)).toBe("That file could not be read.");
    expect(importSentence("validation_error", t)).toBeNull();
  });
});

describe("the export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  it("last month is the whole month before, and the checks are plain", () => {
    expect(lastMonth(new Date(2026, 9, 12))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(lastMonth(new Date(2026, 0, 5))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(rangeProblem("2026-09-30", "2026-09-01")).toBe("order");
    expect(rangeProblem("", "2026-09-01")).toBe("missing");
    expect(rangeProblem("2026-09-01", "2026-09-01")).toBeNull();
    expect(fallbackName("tally_zip", "2026-09-01", "2026-09-30")).toBe("accounts-2026-09-01-to-2026-09-30.zip");
    expect(fallbackName("vyapar_xlsx", "a", "b")).toMatch(/\.xlsx$/);
  });
  it("offers the file types the API reports, asks for the range, downloads the file and shows the counts", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="accounts.zip"', "X-Export-Sales": "4", "X-Export-Payments": "2" } });
    }) as unknown as typeof fetch;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<DataExport tenantId={T} words={WORDS} formats={["tally_zip", "vyapar_xlsx", "csv"]} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Tally: masters and vouchers/ })).toBeChecked();
    expect(screen.getByText(/Try one voucher on a copy of your Tally company/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-31" } });
    await press("Download the file");
    expect(calls[0].url).toBe(`/app/tenants/${T}/data/export`);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ format: "tally_zip", from_date: "2026-08-01", to_date: "2026-08-31" });
    expect(body.export_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("File downloaded: 4 sales and 2 payments.");
    click.mockRestore();
  });
  it("an empty period says so; a start after the end blocks the button", async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "X-Export-Sales": "0", "X-Export-Payments": "0" } })) as unknown as typeof fetch;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<DataExport tenantId={T} words={WORDS} formats={["csv"]} />);
    await press("Download the file");
    expect(screen.getByRole("status")).toHaveTextContent(/no sales or payments in these days/);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2030-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a start date that is not after the end date.");
    expect(screen.getByRole("button", { name: "Download the file" })).toBeDisabled();
    click.mockRestore();
  });
  it.each([
    [{ ok: false, kind: "mfa", error: "", mfa: true }, 403, /second step/],
    [{ ok: false, kind: "invalid", error: "", code: "export_too_large" }, 422, /too many rows for one file/],
    [{ ok: false, kind: "rate_limited", error: "", retryAfter: 9 }, 429, /Wait 9 seconds/],
    [{ ok: false, kind: "forbidden", error: "" }, 403, /Your role cannot/],
  ])("a refusal (%j) is said in words, and no file is made", async (body, status, words) => {
    globalThis.fetch = vi.fn(async () => json(body, status)) as unknown as typeof fetch;
    render(<DataExport tenantId={T} words={WORDS} formats={["csv"]} />);
    await press("Download the file");
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("with no file types it says so instead of an empty form", () => {
    render(<DataExport tenantId={T} words={WORDS} formats={[]} />);
    expect(screen.getByText("No file types are available right now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download the file" })).toBeNull();
  });
});

describe("the calendar address", () => {
  const FEED = { url: "https://api.example.test/v1/calendar/feed/abc.ics", webcal: "webcal://api.example.test/v1/calendar/feed/abc.ics", created_at: "2026-10-12T10:00:00Z" };
  it("says there is none yet, makes one, shows it once with the warning, and a copy button that works", async () => {
    const make = vi.fn(async () => ({ ok: true as const, feed: FEED }));
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CalendarFeed words={WORDS} feed={{ active: false, created_at: null, last_used_at: null }} make={make} revoke={vi.fn()} />);
    expect(screen.getByText("You do not have a calendar address yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop this address" })).toBeNull();
    await press("Make my calendar address");
    expect(make).toHaveBeenCalledTimes(1);
    expect(screen.getByText(FEED.url)).toBeInTheDocument();
    expect(screen.getByText(/This is the only time you will see this address/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "On a phone, add it to your calendar" })).toHaveAttribute("href", FEED.webcal);
    await press("Copy");
    expect(writeText).toHaveBeenCalledWith(FEED.url);
    expect(screen.getAllByText("Copied").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Make a new address" })).toBeInTheDocument();
  });
  it("when copying is refused it says how to copy by hand", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    render(<CalendarFeed words={WORDS} feed={{ active: false, created_at: null, last_used_at: null }} make={async () => ({ ok: true, feed: FEED })} revoke={vi.fn()} />);
    await press("Make my calendar address");
    await press("Copy");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not copy. Select the address and copy it by hand.");
  });
  it("an active address shows when it was made and that it was not used, and revoking removes the address from the page", async () => {
    const revoke = vi.fn(async () => ({ ok: true as const }));
    render(<CalendarFeed words={WORDS} feed={{ active: true, created_at: "2026-10-12T10:00:00Z", last_used_at: null }} make={vi.fn()} revoke={revoke} />);
    expect(screen.getByText("Your calendar address is on.")).toBeInTheDocument();
    expect(screen.getByText("Not used yet.")).toBeInTheDocument();
    expect(screen.queryByText(FEED.url)).toBeNull(); // the address is never shown again
    await press("Stop this address");
    expect(revoke).toHaveBeenCalled();
    expect(screen.getByText("The address no longer works.")).toBeInTheDocument();
  });
  it("a refusal (429) is said and nothing is shown", async () => {
    const make = vi.fn(async () => ({ ok: false as const, kind: "rate_limited" as const, error: "", retryAfter: 12 }));
    render(<CalendarFeed words={WORDS} feed={{ active: false, created_at: null, last_used_at: null }} make={make} revoke={vi.fn()} />);
    await press("Make my calendar address");
    expect(screen.getByRole("alert")).toHaveTextContent("Wait 12 seconds");
    expect(screen.queryByText(FEED.url)).toBeNull();
  });
});

describe("the Data part of Settings", () => {
  const feed = { ok: true as const, data: { active: false, created_at: null, last_used_at: null } };
  const none = vi.fn();
  it("an admin sees the import, the recent imports, the export and the calendar", () => {
    render(<DataSection tenantId={T} words={WORDS} admin formats={{ ok: true, data: ["csv"] }} jobs={{ ok: true, data: [{ id: JOB, kind: "stock", status: "completed", counts: {}, created_at: "2026-10-12T10:00:00Z", completed_at: null }] }} feed={feed} makeFeed={none} revokeFeed={none} />);
    for (const name of ["Bring in a spreadsheet", "Recent imports", "Send your books to your accountant", "Visits in your phone's calendar"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Saree stock")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
  it("a salesperson sees only the calendar, with a sentence about why", () => {
    render(<DataSection tenantId={T} words={WORDS} admin={false} formats={null} jobs={null} feed={feed} makeFeed={none} revokeFeed={none} />);
    expect(screen.queryByRole("heading", { name: "Bring in a spreadsheet" })).toBeNull();
    expect(screen.getByText(/Importing and exporting is for the owner and admins/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visits in your phone's calendar" })).toBeInTheDocument();
  });
  it("a part that was refused (403) or limited (429) says so in its place, and the rest of the page stays", () => {
    render(<DataSection tenantId={T} words={WORDS} admin formats={{ ok: false, kind: "forbidden" }} jobs={{ ok: false, kind: "rate_limited", retryAfter: 15 }} feed={{ ok: false, kind: "unavailable" }} makeFeed={none} revokeFeed={none} />);
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.getByText(/Wait 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText("This part could not be loaded. The rest of the page is fine.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bring in a spreadsheet" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2); // the refusal has no retry
  });
  it("no recent imports yet is said, not an empty table", () => {
    render(<DataSection tenantId={T} words={WORDS} admin formats={{ ok: true, data: [] }} jobs={{ ok: true, data: [] }} feed={feed} makeFeed={none} revokeFeed={none} />);
    expect(screen.getByText("No imports yet.")).toBeInTheDocument();
  });
});
