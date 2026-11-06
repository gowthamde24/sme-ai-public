import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getBillingAccess = vi.fn();
const DemoVideoScreen = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/billing-access", () => ({ getBillingAccess: (...a: unknown[]) => getBillingAccess(...a) }));
vi.mock("./demo-video-screen", () => ({ DemoVideoScreen: (p: unknown) => DemoVideoScreen(p) }));

import DemoVideoPage from "./page";

const T = "11111111-1111-4111-8111-111111111111";
const props = (tenantId = T) => ({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve({}) }) as unknown as Parameters<typeof DemoVideoPage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_VIDEO", "on");
  requireUser.mockResolvedValue({ id: "u", email: "owner@demo.example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, name: "DEMO Staging Textiles (synthetic)", slug: "demo", role: "owner" });
  getBillingAccess.mockResolvedValue({ readOnly: false, demo: true });
  DemoVideoScreen.mockReturnValue("video");
});

describe("the demo video's page", () => {
  it("is the story in a demo workspace, for its Owner, with the flag on (and the story gets no more than the workspace and the token's reader)", async () => {
    expect(await DemoVideoPage(props())).toBe("video");
    expect(DemoVideoScreen).toHaveBeenCalledWith({ accessToken: "tok", tenantId: T });
  });

  it.each([
    ["the flag is off", () => vi.stubEnv("DEMO_VIDEO", "")],
    ["the workspace is a real customer's", () => getBillingAccess.mockResolvedValue({ readOnly: false, demo: false })],
    ["the API does not say it is a demo (the DEMO name is not enough)", () => getBillingAccess.mockResolvedValue({ readOnly: false })],
    ["the person is Sales", () => fetchTenant.mockResolvedValue({ id: T, name: "DEMO x", slug: "d", role: "sales" })],
    ["the API cannot be read", () => getBillingAccess.mockRejectedValue(new Error("down"))],
  ])("sends the person to the normal Today when %s", async (_why, arrange) => {
    arrange();
    await expect(DemoVideoPage(props())).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(`/app/tenants/${T}`);
    expect(DemoVideoScreen).not.toHaveBeenCalled();
  });
});
