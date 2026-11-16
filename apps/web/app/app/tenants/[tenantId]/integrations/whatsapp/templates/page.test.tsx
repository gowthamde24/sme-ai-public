import { describe, expect, it, vi } from "vitest";

import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));

import OldTemplatesAddress from "./page";

const props = (id: string) => ({ params: Promise.resolve({ tenantId: id }) }) as unknown as Parameters<typeof OldTemplatesAddress>[0];

describe("the old address of the templates (integrations/whatsapp/templates)", () => {
  it("sends to the Templates tab of Chats; an address that is not a workspace is not found", async () => {
    await expect(OldTemplatesAddress(props(TENANT))).rejects.toThrow(`/app/tenants/${TENANT}/chats/templates`);
    await expect(OldTemplatesAddress(props("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
