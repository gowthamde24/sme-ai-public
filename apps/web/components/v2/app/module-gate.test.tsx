import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { ModuleGate } from "./frame-store";
import type { PackFrame } from "./nav";

const T = "22222222-2222-2222-2222-222222222222";
const pack = (modules: string[]): PackFrame => ({ name: "X", accent: "sky_blue", validated: false, coreTab: "fees", modules, labels: {} });
const at = (p: string) => {
  nav.pathname = `/app/tenants/${T}${p}`;
};
const draw = async (p: PackFrame) => {
  await act(async () => {
    render(
      <ModuleGate modules={p.modules} fallback={<p>the 403 page</p>}>
        <p>the page</p>
      </ModuleGate>,
    );
  });
};
afterEach(cleanup);

describe("the module guard for a move inside the app", () => {
  it("draws the 403 page instead of a page whose module is off for the business type", async () => {
    at("/orders");
    await draw(pack(["today", "fees"]));
    expect(screen.getByText("the 403 page")).toBeInTheDocument();
    expect(screen.queryByText("the page")).toBeNull();
  });
  it("draws the page when the module is on, and for a page that needs none", async () => {
    at("/fees");
    await draw(pack(["today", "fees"]));
    expect(screen.getByText("the page")).toBeInTheDocument();
    cleanup();
    at("/settings");
    await draw(pack(["today"]));
    expect(screen.getByText("the page")).toBeInTheDocument();
  });
});
