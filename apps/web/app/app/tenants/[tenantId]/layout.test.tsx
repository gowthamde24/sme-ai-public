import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFrameData = vi.fn();
const readAgents = vi.fn();
const readAccess = vi.fn();
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("./today-read", () => ({ readAgentsCached: (...a: unknown[]) => readAgents(...a), readAccessCached: (...a: unknown[]) => readAccess(...a) }));
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
    readAccess.mockReset();
    readAccess.mockResolvedValue({ readOnly: false });
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA });
    nav.pathname = `/app/tenants/${T}/orders`;
  });
  it("a read-only workspace (job DP) gets the one notice at the top and the scope that switches the controls off, and no floating Ask orb; a full one gets neither; a read that fails is 'full' (the API refuses every change anyway)", async () => {
    readAgents.mockResolvedValue(teamWith("idle"));
    readAccess.mockResolvedValue({ readOnly: true, since: "2026-10-20", deleteOn: "2027-01-18", daysLeft: 85, canResume: true });
    const { rerender } = render(await TenantLayout(props(T)));
    expect(readAccess).toHaveBeenCalledWith("tok", T);
    expect(document.querySelector("[data-readonly-banner]")).toHaveTextContent(/read-only/i);
    expect(document.querySelector("[data-readonly-banner]")).toHaveTextContent("billing@");
    expect(document.querySelector("[data-readonly-banner] a[href$='/plans']")).toHaveTextContent("Pay again and continue"); // the plan can be paid for again: the way to it
    expect(document.querySelector("[data-readonly-banner]")).toHaveAttribute("data-read-ok"); // the scope never switches the way out off
    expect(document.querySelector("[data-ask='orb']")).toBeNull();
    expect(document.body.textContent).toContain("page");
    readAccess.mockResolvedValue({ readOnly: false });
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-readonly-banner]")).toBeNull();
    expect(document.querySelector("[data-ask='orb']")).not.toBeNull();
    readAccess.mockRejectedValue(new Error("not read"));
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-readonly-banner]")).toBeNull();
  });
  it("draws the floating Ask orb (job DQ part 0) on a screen when the assistant can be asked, and not on Today (its card is the assistant) or the live call; there is no bar at the bottom", async () => {
    readAgents.mockResolvedValue(teamWith("idle"));
    const { rerender } = render(await TenantLayout(props(T)));
    expect(readAgents).toHaveBeenCalledWith("tok", T);
    expect(document.querySelector("[data-ask='orb']")).not.toBeNull();
    nav.pathname = `/app/tenants/${T}`;
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-ask='orb']")).toBeNull(); // Today has its own line, in the card
    nav.pathname = `/app/tenants/${T}/office/live`;
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-ask='orb']")).toBeNull(); // the live call needs the whole screen
    nav.pathname = `/app/tenants/${T}/orders`;
    // switched off for the workspace (the first-run state): the orb is there and opens the line with the button that turns the assistant on; a system with no assistant has no orb at all
    readAgents.mockResolvedValue(teamWith("switched_off"));
    rerender(await TenantLayout(props(T)));
    await waitFor(() => expect(document.querySelector("[data-ask='orb'][data-ask-off='true']")).not.toBeNull()); // its code is a chunk of its own
    readAgents.mockResolvedValue(teamWith("not_available"));
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-ask='orb']")).toBeNull();
    readAgents.mockRejectedValue(new Error("not read"));
    rerender(await TenantLayout(props(T)));
    expect(document.querySelector("[data-ask='orb']")).toBeNull();
    expect(document.body.textContent).toContain("page"); // the page is drawn all the same
    expect(document.querySelector("[data-dock]")).toBeNull(); // the bar at the bottom is gone
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
