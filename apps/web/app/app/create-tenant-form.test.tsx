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
