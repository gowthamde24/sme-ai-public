import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readFrameData = vi.fn();
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("../../frame-data", () => ({ readFrameData: (...a: unknown[]) => readFrameData(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok", email: "a@b.test" }) }));
const slot = vi.fn();
vi.mock("@/components/v2/app/frame-store", async (orig) => ({ ...(await orig<typeof import("@/components/v2/app/frame-store")>()), FrameDataSlot: (p: unknown) => (slot(p), null) }));

import { NO_FRAME_DATA } from "@/components/v2/app/contract";

import TenantLayout from "./layout";

const T = "22222222-2222-2222-2222-222222222222";
const props = (id: string) => ({ children: <p>page</p>, params: Promise.resolve({ tenantId: id }) }) as unknown as Parameters<typeof TenantLayout>[0];

describe("the workspace layout", () => {
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
  it("puts the module gate (the 403 page for a move inside the app) only around the page of a business type that is not the default", async () => {
    const { parseWorkspacePack } = await import("@/lib/api/pack");
    const { packFrame } = await import("@/lib/packs/resolve");
    const education = parseWorkspacePack({ pack: "education", modules: ["today", "fees"] });
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA, pack: packFrame(education.def, education.modules, "en") });
    nav.pathname = `/app/tenants/${T}/orders`;
    const { queryByText, rerender } = render(await TenantLayout(props(T)));
    expect(queryByText("page")).toBeNull(); // the gate drew the 403 page
    expect(document.querySelector("[data-problem='403']")).not.toBeNull();
    nav.pathname = `/app/tenants/${T}/fees`;
    rerender(await TenantLayout(props(T)));
    expect(queryByText("page")).not.toBeNull();
    const plain = parseWorkspacePack({ pack: "textiles" });
    readFrameData.mockResolvedValue({ ...NO_FRAME_DATA, pack: packFrame(plain.def, plain.modules, "en") });
    nav.pathname = `/app/tenants/${T}/fees`;
    rerender(await TenantLayout(props(T)));
    expect(queryByText("page")).not.toBeNull(); // no gate for the default business type
  });
});
