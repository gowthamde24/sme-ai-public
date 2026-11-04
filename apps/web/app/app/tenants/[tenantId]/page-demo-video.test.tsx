import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getBillingAccess = vi.fn();
const TodayScreen = vi.fn();
const DemoVideoScreen = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/billing-access", () => ({ getBillingAccess: (...a: unknown[]) => getBillingAccess(...a) }));
vi.mock("./today-screen", () => ({ TodayScreen: (p: unknown) => TodayScreen(p) }));
vi.mock("./demo-video-screen", () => ({ DemoVideoScreen: (p: unknown) => DemoVideoScreen(p) }));
vi.mock("./actions", () => ({ createCompanyAction: vi.fn(async () => undefined) }));

import TenantPage from "./page";

const T = "11111111-1111-4111-8111-111111111111";
const props = (query: Record<string, string>) => ({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof TenantPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_VIDEO", "on");
  requireUser.mockResolvedValue({ id: "u", email: "owner@demo.example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, name: "DEMO Staging Textiles (synthetic)", slug: "demo", role: "owner" });
  getBillingAccess.mockResolvedValue({ readOnly: false, demo: true });
  TodayScreen.mockReturnValue("today");
  DemoVideoScreen.mockReturnValue("video");
});

describe("Today with ?demo=video", () => {
  it("is the demo video in a demo workspace, for its Owner, with the flag on (and the story gets no more than the workspace and the token's reader)", async () => {
    expect(await TenantPage(props({ demo: "video" }))).toBe("video");
    expect(DemoVideoScreen).toHaveBeenCalledWith({ accessToken: "tok", tenantId: T });
    expect(TodayScreen).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is off", () => vi.stubEnv("DEMO_VIDEO", "")],
    ["the workspace is a real customer's", () => getBillingAccess.mockResolvedValue({ readOnly: false, demo: false })],
    ["the API does not say it is a demo (the DEMO name is not enough)", () => getBillingAccess.mockResolvedValue({ readOnly: false })],
    ["the person is Sales", () => fetchTenant.mockResolvedValue({ id: T, name: "DEMO x", slug: "d", role: "sales" })],
  ])("is the normal Today when %s", async (_why, arrange) => {
    arrange();
    expect(await TenantPage(props({ demo: "video" }))).toBe("today");
    expect(DemoVideoScreen).not.toHaveBeenCalled();
  });

  it("is the normal Today for any other word, and never on a records tab", async () => {
    expect(await TenantPage(props({ demo: "1" }))).toBe("today");
    expect(await TenantPage(props({}))).toBe("today");
    expect(DemoVideoScreen).not.toHaveBeenCalled();
    expect(getBillingAccess).not.toHaveBeenCalled();
  });
});
