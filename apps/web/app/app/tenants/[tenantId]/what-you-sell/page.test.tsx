import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import { pageJson } from "@/lib/api/catalogue-fixtures";
import { workspacePack } from "@/lib/packs/pack-test-kit";
import { NotFoundSignal, RedirectError, notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const readPack = vi.fn();
const request = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a), apiRequest: (...a: unknown[]) => request(...a) }));
vi.mock("@/components/v2/app/sell/LazyWork", () => ({ loadWork: async () => undefined, LazyWork: () => null }));
vi.mock("@/components/v2/app/sell/LazySection", async () => ({ SellSection: (await import("@/components/v2/app/sell/SellSection")).SellSection }));

import Page from "./page";

const T = "22222222-2222-2222-2222-222222222222";
const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(search) }) as never;
const draw = async (search: Record<string, string> = {}) => {
  const el = await Page(props(search));
  await act(async () => void render(el));
};
beforeEach(() => {
  vi.resetAllMocks();
  redirectMock.mockImplementation((to: string) => {
    throw new RedirectError(to);
  });
  notFoundMock.mockImplementation((): never => {
    throw new NotFoundSignal();
  });
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, name: "Acme", slug: "acme", role: "owner" });
  readPack.mockResolvedValue(workspacePack("textiles"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the What you sell page", () => {
  it("JOBS off: the page is not there (404) and nothing is read", async () => {
    await expect(Page(props())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("a workspace id that is not one is a 404; a rejected session goes to sign-in", async () => {
    vi.stubEnv("JOBS", "mock");
    await expect(Page({ params: Promise.resolve({ tenantId: "x" }), searchParams: Promise.resolve({}) } as never)).rejects.toBeInstanceOf(NotFoundSignal);
    fetchTenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(Page(props())).rejects.toBeInstanceOf(RedirectError);
  });
  it("test mode: the style follows the pack (a clinic: services) and ?style= shows another so all five can be seen", async () => {
    vi.stubEnv("JOBS", "mock");
    readPack.mockResolvedValue(workspacePack("clinic"));
    await draw();
    expect(screen.getByRole("heading", { name: /Services/ })).toBeInTheDocument();
    expect(screen.getByText(/Test mode: these are made-up examples/)).toBeInTheDocument();
    cleanup();
    await draw({ style: "courses" });
    expect(screen.getByRole("heading", { name: /Courses/ })).toBeInTheDocument();
  });
  it("a real workspace always gets its pack's style: ?style= is ignored, and the saree shop reads its catalogue with the person's token", async () => {
    vi.stubEnv("JOBS", "1");
    request.mockResolvedValue(pageJson());
    await draw({ style: "courses" });
    expect(screen.getByRole("heading", { name: /Products/ })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/catalogue/items"), "tok");
    expect(screen.queryByText(/Test mode/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open the old page" })).toHaveAttribute("href", `/app/tenants/${T}/catalogue`);
    expect(screen.getByRole("link", { name: "Open the price list for quotes" })).toHaveAttribute("href", `/app/tenants/${T}/price-list`);
  });
  it("a business whose style has no API yet is told so in one sentence (never an empty guess)", async () => {
    vi.stubEnv("JOBS", "1");
    readPack.mockResolvedValue(workspacePack("real_estate"));
    await draw();
    expect(screen.getByText(/not ready for your kind of business yet/)).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
  it("Owner and Admin get the three ways to fill it; Sales and Viewer read", async () => {
    vi.stubEnv("JOBS", "mock");
    await draw();
    expect(screen.getByText("Take photos")).toBeInTheDocument();
    cleanup();
    fetchTenant.mockResolvedValue({ id: T, name: "Acme", slug: "acme", role: "sales" });
    await draw();
    expect(screen.queryByText("Take photos")).toBeNull();
    expect(screen.getByText("Kanjivaram silk saree")).toBeInTheDocument();
  });
});
