import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parseItem } from "@/lib/api/materials";
import { ITEM, ITEM_JSON, PHOTO_JSON } from "@/lib/api/materials-fixtures";

import type { Uploader } from "../catalogue/catalogue-types";
import { ProductEditor, type EditorActions } from "./ProductEditor";
import { BASE, WORDS } from "./mat-test-kit";

const item = parseItem(ITEM_JSON);
const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;
function acts(over: Partial<EditorActions> = {}) {
  return {
    save: vi.fn(async () => ({ ok: true as const, item })),
    saveCustom: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const, item })),
    reorder: vi.fn(async () => ({ ok: true as const, item })),
    ...over,
  } as EditorActions & Record<string, ReturnType<typeof vi.fn>>;
}
function show(over: Partial<React.ComponentProps<typeof ProductEditor>> = {}, a = acts()) {
  const go = vi.fn();
  const uploader: Uploader = vi.fn(async (_f, photoId) => ({ ok: true as const, photo: { ...PHOTO_JSON, id: photoId }, photos: [{ ...PHOTO_JSON, id: photoId }] }));
  render(<ProductEditor base={BASE} itemId={ITEM} item={null} role="owner" words={WORDS} actions={a} uploadUrl={`${BASE}/materials/${ITEM}/material-photos`} go={go} uploader={uploader} prepare={async (f) => ({ ok: true, blob: f })} {...over} />);
  return { a, go, uploader };
}
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
});

describe("adding a product", () => {
  it("needs a name", async () => {
    const { a } = show();
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Give the product a name");
    expect(a.save).not.toHaveBeenCalled();
  });
  it("sends the details with the page's id, then goes to the product", async () => {
    const { a, go } = show();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver block 80 mm" } });
    fireEvent.change(screen.getByLabelText("You sell it by"), { target: { value: "sq_ft" } });
    fireEvent.change(screen.getByLabelText("Customers give the area in"), { target: { value: "sq_ft" } });
    fireEvent.change(screen.getByLabelText(/Price per unit/), { target: { value: "65" } });
    await save();
    expect(a.save).toHaveBeenCalledWith(ITEM, { name: "Paver block 80 mm", sellUnit: "sq_ft", areaUnit: "sq_ft", stockStatus: "in_stock", active: false, price: { rupees: 65 } });
    expect(go).toHaveBeenCalledWith(`${BASE}/materials/${ITEM}?saved=1`);
  });
  it("a price that is not an amount is refused before the server", async () => {
    const { a } = show();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    fireEvent.change(screen.getByLabelText(/Price per unit/), { target: { value: "sixty" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the price in rupees");
    expect(a.save).not.toHaveBeenCalled();
  });
  it("only the Owner sees the price box; an Admin's form sends no price", async () => {
    const { a } = show({ role: "admin" });
    expect(screen.queryByLabelText(/Price per unit/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    await save();
    expect(mocked(a.save).mock.calls[0][1]).not.toHaveProperty("price");
  });
  it("the server's refusal is shown in our sentence, with the Security link for the second factor", async () => {
    show({}, acts({ save: vi.fn(async () => ({ ok: false as const, error: "This needs your two-step code, if you turned it on.", mfa: true })) as never }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("two-step code");
    expect(screen.getByRole("link", { name: /Security/ })).toBeInTheDocument();
  });
});

describe("photos and the extra details", () => {
  it("uploads a picked photo after the details, shows the product only once a photo is there", async () => {
    const hidden = { ...item, active: false };
    const { a, uploader, go } = show({}, acts({ save: vi.fn(async () => ({ ok: true as const, item: hidden })) as never }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(document.querySelector('[data-input="choose"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show this product to customers" }));
    await save();
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(a.save).toHaveBeenCalledTimes(2);
    expect(mocked(a.save).mock.calls[0][1].active).toBe(false);
    expect(mocked(a.save).mock.calls[1][1].active).toBe(true);
    expect(go).toHaveBeenCalledWith(`${BASE}/materials/${ITEM}?saved=1`);
  });
  it("a product with no photo cannot be shown", () => {
    show();
    expect(screen.getByRole("checkbox", { name: "Show this product to customers" })).toBeDisabled();
  });
  it("a photo that fails stays on the page with a word, and the other work is not lost", async () => {
    const { go } = show({ uploader: vi.fn(async () => ({ ok: false as const, code: "photo_too_large" })) });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    fireEvent.change(document.querySelector('[data-input="choose"]') as HTMLInputElement, { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
    await save();
    expect(go).not.toHaveBeenCalled();
    expect(screen.getAllByRole("status").map((n) => n.textContent).join(" ")).toContain("some photos did not upload");
  });
  it("keeps the extra details (GST rate, HSN ...) after the product", async () => {
    const { a } = show({ fields: [{ code: "gst_rate_percent", kind: "number", label: "GST rate in percent", required: false, pii: "none" }], custom: { gst_rate_percent: 18 } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paver" } });
    await save();
    expect(a.saveCustom).toHaveBeenCalledWith(ITEM, { gst_rate_percent: 18 });
  });
});

describe("changing a product", () => {
  it("starts from what is saved and offers to clear the price (Owner)", async () => {
    const { a } = show({ item });
    expect(screen.getByLabelText("Name")).toHaveValue(item.name);
    expect(screen.getByText("Exact price now: ₹65 per sq ft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Remove the exact price" }));
    await save();
    expect(mocked(a.save).mock.calls[0][1].price).toEqual({ clear: true });
  });
});
