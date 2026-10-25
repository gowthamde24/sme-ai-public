import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFrameData = vi.fn();
const readAgents = vi.fn();
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("./today-read", () => ({ readAgentsCached: (...a: unknown[]) => readAgents(...a) }));
vi.mock("../../frame-data", () => ({ readFrameData: (...a: unknown[]) => readFrameData(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok", email: "a@b.test" }) }));
const slot = vi.fn();
vi.mock("@/components/v2/app/frame-store", async (orig) => ({ ...(await orig<typeof import("@/components/v2/app/frame-store")>()), FrameDataSlot: (p: unknown) => (slot(p), null) }));

import { NO_FRAME_DATA } from "@/components/v2/app/contract";

import TenantLayout from "./layout";

const T = "22222222-2222-2222-2222-222222222222";
const props = (id: string) => ({ children: <p>page</p>, params: Promise.resolve({ tenantId: id }) }) as unknown as Parameters<typeof TenantLayout>[0];

const teamWith = (main: string) => [{ agent: "main", state: main }];

describe("the workspace layout", () => {
  beforeEach(() => {
    readAgents.mockReset();
    readAgents.mockResolvedValue([]);
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA });
    nav.pathname = `/app/tenants/${T}/orders`;
  });
  it("draws the Ask dock (job DN) on a main screen when the assistant can be asked, and nowhere else", async () => {
    readAgents.mockResolvedValue(teamWith("idle"));
    const { rerender } = render(await TenantLayout(props(T)));
    expect(readAgents).toHaveBeenCalledWith("tok", T);
    expect(document.querySelector("[data-dock='ask']")).not.toBeNull();
    nav.pathname = `/app/tenants/${T}`;
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-dock='ask']")).toBeNull(); // Today has its own line
    nav.pathname = `/app/tenants/${T}/orders`;
    for (const state of ["switched_off", "not_available"]) {
      readAgents.mockResolvedValue(teamWith(state));
      rerender(await TenantLayout(props(T)));
      expect(document.querySelector("[data-dock='ask']"), state).toBeNull();
    }
    readAgents.mockRejectedValue(new Error("not read"));
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-dock='ask']")).toBeNull();
    expect(document.body.textContent).toContain("page"); // the page is drawn all the same
  });
  it("reads the frame's numbers for THIS workspace with the signed-in person's token and hands them to the frame, then draws the page", async () => {
    const data = { ...NO_FRAME_DATA, waiting: 3 };
    readFrameData.mockResolvedValue(data);
    const { getByText } = render(await TenantLayout(props(T)));
    expect(readFrameData).toHaveBeenCalledWith("tok", T, expect.any(String)); // the language, for the business type's words
    expect(slot).toHaveBeenCalledWith({ data });
    expect(getByText("page")).toBeInTheDocument();
  });
  it("asks the API nothing for an address that is not a workspace id (the page then says not found)", async () => {
    readFrameData.mockClear();
    render(await TenantLayout(props("not-a-uuid")));
    expect(readFrameData).not.toHaveBeenCalled();
    expect(slot).toHaveBeenLastCalledWith({ data: NO_FRAME_DATA });
  });
  it("puts the module gate (the 403 page for a move inside the app) around the page of a workspace that has a business type, and judges the path against its modules", async () => {
    const { workspacePack, otherPackIds } = await import("@/lib/packs/pack-test-kit");
    const { packFrame } = await import("@/lib/packs/resolve");
    const education = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!, "signup", ["today", "fees"]);
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA, pack: packFrame(education, "en") });
    nav.pathname = `/app/tenants/${T}/orders`;
    const { queryByText, rerender } = render(await TenantLayout(props(T)));
    expect(queryByText("page")).toBeNull(); // the gate drew the 403 page
    expect(document.querySelector("[data-problem='403']")).not.toBeNull();
    nav.pathname = `/app/tenants/${T}/fees`;
    rerender(await TenantLayout(props(T)));
    expect(queryByText("page")).not.toBeNull();
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA, pack: null });
    nav.pathname = `/app/tenants/${T}/orders`;
    rerender(await TenantLayout(props(T)));
    expect(queryByText("page")).not.toBeNull(); // a server with no pack routes: no gate, the product as it always was
  });
});
