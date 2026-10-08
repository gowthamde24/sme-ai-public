import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseItemType } from "@/lib/api/item-types";
import { TYPE_A_JSON, TYPE_B_JSON } from "@/lib/api/quotes-fixtures";

import { AddItemTypeForm, EditItemTypeForm } from "./item-type-forms";
import type { ItemTypeState } from "./item-types-actions";
import { CODE_SENTENCE } from "./item-types-logic";

type Fn = (prev: ItemTypeState, data: FormData) => Promise<ItemTypeState>;
const mk = (result: ItemTypeState = { ok: true, message: "Added." }) => vi.fn<Fn>(async () => result);
const typeB = parseItemType(TYPE_B_JSON);
const typeA = parseItemType(TYPE_A_JSON);

describe("the add form", () => {
  it("starts empty, says plainly that the code is typed once and a type is never deleted, and offers no switch", () => {
    render(<AddItemTypeForm add={mk()} />);
    for (const label of ["Name", "Code", "Position in the list (0 comes first)", "Lowest price in rupees (optional)", "Highest price in rupees (optional)"]) expect(screen.getByLabelText(label)).toHaveValue("");
    expect(screen.getByText(CODE_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("sends exactly the five typed fields", async () => {
    const add = mk();
    render(<AddItemTypeForm add={add} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Type D" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "D" } });
    fireEvent.change(screen.getByLabelText("Position in the list (0 comes first)"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Lowest price in rupees (optional)"), { target: { value: "100" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this item type" })));
    expect(add).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(add.mock.calls[0][1].entries())).toEqual({ name: "Type D", code: "D", position: "4", lowest: "100", highest: "" });
  });
  it("shows the action's sentence, and a link to the Security page when the second factor is missing", async () => {
    render(<AddItemTypeForm add={mk({ ok: false, reason: "mfa", error: "Changing item types needs your authenticator app." })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this item type" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("authenticator app");
    expect(screen.getByRole("link", { name: /Security page/ })).toHaveAttribute("href", "/app/security");
  });
  it("shows a success sentence as a status", async () => {
    render(<AddItemTypeForm add={mk()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add this item type" })));
    expect(await screen.findByRole("status")).toHaveTextContent("Added.");
  });
});

describe("the edit form", () => {
  it("shows the saved values in rupees, the code as text that cannot be edited, and the switch", () => {
    render(<EditItemTypeForm type={typeB} save={mk()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Type B");
    expect(screen.getByLabelText("Position in the list (0 comes first)")).toHaveValue("2");
    expect(screen.getByLabelText("Lowest price in rupees (optional)")).toHaveValue("500");
    expect(screen.getByLabelText("Highest price in rupees (optional)")).toHaveValue("4000");
    expect(screen.getByLabelText("Can be used on a new quote")).toBeChecked();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText(/can never be changed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Code")).toBeNull();
  });
  it("a type without a range shows empty price fields; a switched-off type shows the box unticked", () => {
    render(<EditItemTypeForm type={{ ...typeA, active: false }} save={mk()} />);
    expect(screen.getByLabelText("Lowest price in rupees (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Highest price in rupees (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Can be used on a new quote")).not.toBeChecked();
  });
  it("sends the typed fields and the box, and never a code", async () => {
    const save = mk({ ok: true, message: "Saved." });
    render(<EditItemTypeForm type={typeB} save={save} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Type B (new)" } });
    fireEvent.click(screen.getByLabelText("Can be used on a new quote"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    const sent = Object.fromEntries(save.mock.calls[0][1].entries());
    expect(sent).toEqual({ name: "Type B (new)", position: "2", lowest: "500", highest: "4000" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });
  it("shows a ticked box as on", async () => {
    const save = mk({ ok: true, message: "Saved." });
    render(<EditItemTypeForm type={typeB} save={save} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    expect(save.mock.calls[0][1].get("active")).toBe("on");
  });
});
