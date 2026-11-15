import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNotFound, notFoundMock, redirectMock, redirectTarget } from "@/test/helpers";

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));

import ItemTypesPage from "./page";

const T = "22222222-2222-4222-8222-222222222222";
const props = (tenantId = T) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof ItemTypesPage>[0];

beforeEach(() => vi.clearAllMocks());

describe("/app/tenants/[tenantId]/item-types (moved)", () => {
  it("goes to the Price ranges section of the price list page", async () => {
    expect(await redirectTarget(async () => void (await ItemTypesPage(props())))).toBe(`/app/tenants/${T}/price-list#price-ranges`);
  });
  it("a malformed workspace id is the not-found page, nothing is redirected", async () => {
    expect(await isNotFound(async () => void (await ItemTypesPage(props("not-a-uuid"))))).toBe(true);
  });
});
