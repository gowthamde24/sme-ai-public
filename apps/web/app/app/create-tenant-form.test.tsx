import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ createTenantAction: vi.fn(async () => undefined) }));

import { CreateTenantForm } from "./create-tenant-form";

describe("CreateTenantForm", () => {
  it("two forms on one page (the side menu and /app) have ids of their own, and each label still points at its own field", () => {
    render(
      <>
        <CreateTenantForm />
        <CreateTenantForm />
      </>,
    );
    const names = screen.getAllByLabelText("Workspace name");
    const slugs = screen.getAllByLabelText("URL name");
    expect(names).toHaveLength(2);
    expect(slugs).toHaveLength(2);
    const ids = [...names, ...slugs].map((el) => el.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(names.map((el) => el.getAttribute("name"))).toEqual(["name", "name"]);
    expect(slugs.map((el) => el.getAttribute("name"))).toEqual(["slug", "slug"]);
  });
});

describe("CreateTenantForm with business types (FIRST_RUN_TYPE)", () => {
  const types = [
    { id: "clinic", name: "Clinic", line: "Doctors and appointments" },
    { id: "textiles", name: "Cloth and sarees", line: "A shop with stock" },
  ];
  it("asks 'What kind of business is this?' as plain rows with a required round radio each, named pack, before the button", () => {
    render(<CreateTenantForm words={{ "start.type.title": "What kind of business is this?" }} types={types} />);
    const group = screen.getByRole("radiogroup", { name: "What kind of business is this?" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) {
      expect(r).toHaveAttribute("name", "pack");
      expect(r).toBeRequired();
    }
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["clinic", "textiles"]);
  });
  it("without types the form is as it was: no business type question", () => {
    render(<CreateTenantForm />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
