import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNotFound, notFoundMock, redirectMock, redirectTarget } from "@/test/helpers";

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));

import QuotePolicyPage from "./page";

const T = "22222222-2222-4222-8222-222222222222";
const props = (tenantId = T, search: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve(search) }) as unknown as Parameters<typeof QuotePolicyPage>[0];

beforeEach(() => vi.clearAllMocks());

describe("/app/tenants/[tenantId]/quote-policy (moved)", () => {
  it("goes to Settings, Quotes", async () => {
    expect(await redirectTarget(async () => void (await QuotePolicyPage(props())))).toBe(`/app/tenants/${T}/settings?section=quotes`);
  });
  it("keeps the 'saved' mark of the materials form", async () => {
    expect(await redirectTarget(async () => void (await QuotePolicyPage(props(T, { saved: "1" }))))).toBe(`/app/tenants/${T}/settings?section=quotes&saved=1`);
  });
  it("a malformed workspace id is the not-found page, nothing is redirected", async () => {
    expect(await isNotFound(async () => void (await QuotePolicyPage(props("../x"))))).toBe(true);
  });
});
