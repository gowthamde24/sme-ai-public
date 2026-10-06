import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { parsePreview } from "@/lib/api/pricelists";
import { BAD_JSON, ITEM_JSON, PREVIEW_JSON } from "@/lib/api/pricelists-fixtures";

import { PriceListImport, breaksText } from "./price-list-import";

const GOOD_TEXT = "sku,name,unit_price,moq,tax_bps\nSYN-KJ-RED-01,x,4200,4,500\n";
const props = (over: Partial<Parameters<typeof PriceListImport>[0]> = {}) => ({
  preview: vi.fn(async () => ({ ok: true as const, preview: parsePreview(PREVIEW_JSON) })),
  commit: vi.fn(async () => ({ ok: true as const, message: "Saved: price list version 2 with 2 products, in force from 6 Oct 2026. Nothing was sent to anyone." })),
  today: "2026-10-06",
  secondFactorMissing: false,
  ...over,
});
const type = (text: string) => fireEvent.change(screen.getByLabelText("Or paste the file's text"), { target: { value: text } });
const check = async () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Check the file" })));

describe("PriceListImport", () => {
  it("starts empty, with the date of today, and says a check writes nothing", () => {
    render(<PriceListImport {...props()} />);
    expect((screen.getByLabelText("The price list starts on") as HTMLInputElement).value).toBe("2026-10-06");
    expect(screen.getByText("Checking writes nothing.")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose a CSV file")).toHaveAttribute("type", "file");
    expect(screen.queryByRole("button", { name: /Save as a new price list version/ })).toBeNull();
  });

  it("a check sends the text and the date to the action, then shows the table of what the file would become", async () => {
    const p = props();
    render(<PriceListImport {...p} />);
    type(GOOD_TEXT);
    await check();
    const table = await screen.findByRole("table", { name: "What the file would become" });
    const sent = ((p.preview as unknown as Mock).mock.calls as [unknown, FormData][])[0][1];
    expect(sent.get("csv")).toBe(GOOD_TEXT);
    expect(sent.get("effective_from")).toBe("2026-10-06");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("SYN-KJ-RED-01");
    expect(rows[1]).toHaveTextContent("₹4,200.00 per piece");
    expect(rows[1]).toHaveTextContent("5%");
    expect(rows[1]).toHaveTextContent("10+ ₹4,000.00; 50+ ₹3,900.00");
    expect(rows[2]).toHaveTextContent("₹2,800.50 per set");
    expect(rows[2]).toHaveTextContent("12.5%");
    expect(rows[2]).toHaveTextContent("(differs)");
    expect(screen.getByRole("heading", { name: "The file is good" })).toBeInTheDocument();
  });

  it("a file with problems lists them with their rows and columns and offers no save", async () => {
    render(<PriceListImport {...props({ preview: vi.fn(async () => ({ ok: true as const, preview: parsePreview(BAD_JSON) })) })} />);
    type("x");
    await check();
    const list = await screen.findByRole("list", { name: "Problems in the file" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Row 1, sku: The sku may use only letters");
    expect(items[1]).toHaveTextContent("Row 3, unit price: This is not an amount in rupees");
    expect(items[2]).toHaveTextContent("The file: The file is too big");
    expect(screen.getByRole("heading", { name: "The file has problems" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save as a new price list version/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("after a clean check the save button works for exactly that text and date, with the check's version id", async () => {
    const p = props();
    render(<PriceListImport {...p} />);
    type(GOOD_TEXT);
    await check();
    const save = await screen.findByRole("button", { name: "Save as a new price list version" });
    expect(save).toBeEnabled();
    const versionId = (document.querySelector('input[name="version_id"]') as HTMLInputElement).value;
    expect(versionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved: price list version 2 with 2 products"));
    const sent = ((p.commit as unknown as Mock).mock.calls as [unknown, FormData][])[0][1];
    expect(sent.get("csv")).toBe(GOOD_TEXT);
    expect(sent.get("effective_from")).toBe("2026-10-06");
    expect(sent.get("version_id")).toBe(versionId);
  });

  it("an edit after the check switches the save off until the file is checked again, and a new check is a new version", async () => {
    render(<PriceListImport {...props()} />);
    type(GOOD_TEXT);
    await check();
    const first = (document.querySelector('input[name="version_id"]') as HTMLInputElement).value;
    expect(await screen.findByRole("button", { name: "Save as a new price list version" })).toBeEnabled();
    type(GOOD_TEXT + "SYN-KJ-BLUE-01,y,4200,4,500\n");
    expect(screen.getByRole("button", { name: "Save as a new price list version" })).toBeDisabled();
    expect(screen.getByText(/changed since the check/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("The price list starts on"), { target: { value: "2026-10-07" } });
    await check();
    expect(screen.getByRole("button", { name: "Save as a new price list version" })).toBeEnabled();
    expect((document.querySelector('input[name="version_id"]') as HTMLInputElement).value).not.toBe(first);
  });

  it("without the second factor a clean check offers the notice, not the save", async () => {
    render(<PriceListImport {...props({ secondFactorMissing: true })} />);
    type(GOOD_TEXT);
    await check();
    expect(await screen.findByRole("note")).toHaveTextContent("Saving a price list needs your authenticator app.");
    expect(screen.getByRole("link", { name: "Set it up on the Security page" })).toHaveAttribute("href", "/app/security");
    expect(screen.queryByRole("button", { name: /Save as a new price list version/ })).toBeNull();
  });

  it("shows a failed check or save as a plain sentence", async () => {
    const p = props({ preview: vi.fn(async () => ({ ok: false as const, error: "Paste the file's text or choose a file first." })) });
    render(<PriceListImport {...p} />);
    await check();
    expect(await screen.findByRole("alert")).toHaveTextContent("Paste the file's text or choose a file first.");
    const q = props({ commit: vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app." })) });
    document.body.innerHTML = "";
    render(<PriceListImport {...q} />);
    type(GOOD_TEXT);
    await check();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Save as a new price list version" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This needs your authenticator app."));
  });

  it("puts a chosen file's text in the box, and refuses one over 2 MB", async () => {
    render(<PriceListImport {...props()} />);
    const input = screen.getByLabelText("Choose a CSV file") as HTMLInputElement;
    const file = new File([GOOD_TEXT], "prices.csv", { type: "text/csv" });
    await act(async () => fireEvent.change(input, { target: { files: [file] } }));
    await waitFor(() => expect((screen.getByLabelText("Or paste the file's text") as HTMLTextAreaElement).value).toBe(GOOD_TEXT));
    const big = new File(["x"], "big.csv");
    Object.defineProperty(big, "size", { value: 2 * 1024 * 1024 + 1 });
    await act(async () => fireEvent.change(input, { target: { files: [big] } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file is too big: at most 2 MB.");
  });

  it("renders a hostile name or sku as text, never as markup", async () => {
    const hostile = parsePreview({ ...PREVIEW_JSON, items: [{ ...ITEM_JSON, sku: "A-1", name: "<img src=x onerror=alert(1)> Boss", catalog_name: "<b>bold</b>" }] });
    render(<PriceListImport {...props({ preview: vi.fn(async () => ({ ok: true as const, preview: hostile })) })} />);
    type("x");
    await check();
    await screen.findByRole("table");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("table b")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> Boss/)).toBeInTheDocument();
  });
});

describe("breaksText", () => {
  it("is 'none' without breaks and a list of quantity and price with them", () => {
    expect(breaksText(parsePreview(PREVIEW_JSON).items[1])).toBe("none");
    expect(breaksText(parsePreview(PREVIEW_JSON).items[0])).toBe("10+ ₹4,000.00; 50+ ₹3,900.00");
  });
});
