import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readFrameData = vi.fn();
vi.mock("../../frame-data", () => ({ readFrameData: (...a: unknown[]) => readFrameData(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok", email: "a@b.test" }) }));
const slot = vi.fn();
vi.mock("@/components/v2/app/frame-store", () => ({ FrameDataSlot: (p: unknown) => (slot(p), null) }));

import { NO_FRAME_DATA } from "@/components/v2/app/contract";

import TenantLayout from "./layout";

const T = "22222222-2222-2222-2222-222222222222";
const props = (id: string) => ({ children: <p>page</p>, params: Promise.resolve({ tenantId: id }) }) as unknown as Parameters<typeof TenantLayout>[0];

describe("the workspace layout", () => {
  it("reads the frame's numbers for THIS workspace with the signed-in person's token and hands them to the frame, then draws the page", async () => {
    const data = { ...NO_FRAME_DATA, waiting: 3 };
    readFrameData.mockResolvedValue(data);
    const { getByText } = render(await TenantLayout(props(T)));
    expect(readFrameData).toHaveBeenCalledWith("tok", T);
    expect(slot).toHaveBeenCalledWith({ data });
    expect(getByText("page")).toBeInTheDocument();
  });
  it("asks the API nothing for an address that is not a workspace id (the page then says not found)", async () => {
    readFrameData.mockClear();
    render(await TenantLayout(props("not-a-uuid")));
    expect(readFrameData).not.toHaveBeenCalled();
    expect(slot).toHaveBeenLastCalledWith({ data: NO_FRAME_DATA });
  });
});
