import { afterEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const renderMyAssistant = vi.fn(async (..._a: unknown[]) => "the overview");
vi.mock("./view", () => ({ renderMyAssistant: (...a: unknown[]) => renderMyAssistant(...a) }));

import Page from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const call = (tab?: string | string[]) => Page({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(tab === undefined ? {} : { tab }) } as never);

describe("the old My assistant addresses (one row: Overview | Train how it talks | Office; owner, 18 Nov 2026)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    redirect.mockClear();
    renderMyAssistant.mockClear();
  });
  it.each(["knowledge", "voice", "rules", "practice"])("?tab=%s lands on that section of Train how it talks", async (tab) => {
    vi.stubEnv("DESIGN_V6", "1");
    await expect(call(tab)).rejects.toThrow(`REDIRECT /app/tenants/${T}/ai-team/training?section=${tab}`);
    expect(renderMyAssistant).not.toHaveBeenCalled();
  });
  it("the address with no tab and ?tab=golive are the Overview (the status card); anything else too", async () => {
    vi.stubEnv("DESIGN_V6", "1");
    for (const tab of [undefined, "golive", "../x"]) await expect(call(tab)).resolves.toBe("the overview");
    expect(renderMyAssistant).toHaveBeenCalledWith(T, "overview");
    expect(redirect).not.toHaveBeenCalled();
  });
  it("is a plain 404 where DESIGN_V6 is off", async () => {
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
