import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProductFormState } from "./actions";
import { ProductForm } from "./product-form";

const T = "22222222-2222-2222-2222-222222222222";
const P = "66666666-6666-4666-8666-666666666666";
const press = async (state: ProductFormState) => {
  const action = vi.fn(async () => state);
  render(<ProductForm action={action} tenantId={T} id={P} />);
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: "KJ-RED" } }); // the browser blocks a submit with a required field empty
  fireEvent.change(screen.getByLabelText("Name (the saree type)"), { target: { value: "Kanjivaram red" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this product" })));
  return action;
};

describe("ProductForm", () => {
  it("sends the page's id as a hidden field and offers Piece and Set", () => {
    const { container } = render(<ProductForm action={vi.fn()} tenantId={T} id={P} />);
    expect(container.querySelector('input[name="id"]')).toHaveValue(P);
    expect(screen.getByRole("option", { name: "Piece" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Set" })).toBeInTheDocument();
    expect((screen.getByLabelText("Code") as HTMLInputElement).pattern).toBe("[A-Za-z0-9._][A-Za-z0-9._\\-]{0,39}");
  });
  it("after a save it says what was added and links the next steps", async () => {
    await press({ ok: true, name: "Kanjivaram red", sku: "KJ-RED" });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Added Kanjivaram red (code KJ-RED).");
    expect(screen.getByRole("link", { name: "Add another product" })).toHaveAttribute("href", `/app/tenants/${T}/products/new`);
    expect(screen.getByRole("link", { name: "See the products" })).toHaveAttribute("href", `/app/tenants/${T}?tab=products`);
  });
  it("an error is an alert of our wording and the form stays", async () => {
    await press({ ok: false, error: "That code is already used by another product, or this form was already used. Change the code or reload the page." });
    expect(await screen.findByRole("alert")).toHaveTextContent("already used");
    expect(screen.getByRole("button", { name: "Add this product" })).toBeInTheDocument();
  });
});
