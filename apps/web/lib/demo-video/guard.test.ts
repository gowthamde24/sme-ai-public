import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTenant = vi.fn();
const getBillingAccess = vi.fn();
const headersGet = vi.fn();
vi.mock("@/lib/api/client", () => ({ fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/billing-access", () => ({ getBillingAccess: (...a: unknown[]) => getBillingAccess(...a) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => headersGet(k) }) }));

import { demoVideoAllowed, requestVideoAddress, videoAddress, videoHref } from "./guard";

const T = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_VIDEO", "on");
  fetchTenant.mockResolvedValue({ id: T, name: "DEMO Staging Textiles (synthetic)", role: "owner" });
  getBillingAccess.mockResolvedValue({ readOnly: false, demo: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("the demo-video guard: who may open the mode", () => {
  it("says yes for the Owner or an Admin of a workspace the API calls a demo one, with the flag on", async () => {
    expect(await demoVideoAllowed("tok", T)).toBe(true);
    fetchTenant.mockResolvedValue({ id: T, name: "x", role: "admin" });
    expect(await demoVideoAllowed("tok", T)).toBe(true);
    vi.stubEnv("DEMO_VIDEO", "1");
    expect(await demoVideoAllowed("tok", T)).toBe(true);
  });

  it.each([
    ["the flag is unset", () => vi.stubEnv("DEMO_VIDEO", "")],
    ["the flag is anything but on or 1", () => vi.stubEnv("DEMO_VIDEO", "true")],
    ["the person is Sales", () => fetchTenant.mockResolvedValue({ id: T, name: "DEMO x", role: "sales" })],
    ["the person is a Viewer", () => fetchTenant.mockResolvedValue({ id: T, name: "DEMO x", role: "viewer" })],
    ["the API says it is a real customer's workspace", () => getBillingAccess.mockResolvedValue({ readOnly: false, demo: false })],
    // a real customer can call a business "DEMO ...": the name alone never opens it
    ["the API does not say (a name that starts with DEMO is not enough)", () => getBillingAccess.mockResolvedValue({ readOnly: false })],
    ["the role cannot be read", () => fetchTenant.mockRejectedValue(new Error("down"))],
    ["the access cannot be read", () => getBillingAccess.mockRejectedValue(new Error("down"))],
  ])("says no when %s", async (_why, arrange) => {
    arrange();
    expect(await demoVideoAllowed("tok", T)).toBe(false);
  });

  it("asks nothing for an address that is not a workspace id, or with the flag off", async () => {
    expect(await demoVideoAllowed("tok", "not-a-uuid")).toBe(false);
    vi.stubEnv("DEMO_VIDEO", "");
    expect(await demoVideoAllowed("tok", T)).toBe(false);
    expect(fetchTenant).not.toHaveBeenCalled();
    expect(getBillingAccess).not.toHaveBeenCalled();
  });
});

describe("the address of the mode", () => {
  it("is ?demo=video on a workspace's Today", () => {
    expect(videoHref(T)).toBe(`/app/tenants/${T}?demo=video`);
    expect(videoAddress(videoHref(T))).toEqual({ tenantId: T, today: true });
    expect(videoAddress(`/app/tenants/${T}/?demo=video&lang=en`)).toEqual({ tenantId: T, today: true });
  });
  it("on any other screen of the workspace asks for it too, but not as Today (the layout starts the story at step 1)", () => {
    expect(videoAddress(`/app/tenants/${T}/retailers?demo=video`)).toEqual({ tenantId: T, today: false });
    expect(videoAddress(`/app/tenants/${T}?tab=leads&demo=video`)).toEqual({ tenantId: T, today: false });
  });
  it("is not asked for without the exact word, or outside a workspace", () => {
    for (const p of [`/app/tenants/${T}`, `/app/tenants/${T}?demo=1`, `/app/tenants/${T}?demo=VIDEO`, "/app?demo=video", "/app/tenants/not-a-uuid?demo=video", "/landing?demo=video", "", null, undefined]) expect(videoAddress(p)).toBeNull();
  });
  it("is read from the proxy's own header, and is none outside a request", async () => {
    headersGet.mockImplementation((k: string) => (k === "x-sme-path" ? `/app/tenants/${T}?demo=video` : null));
    expect(await requestVideoAddress()).toEqual({ tenantId: T, today: true });
    headersGet.mockImplementation(() => {
      throw new Error("outside a request");
    });
    expect(await requestVideoAddress()).toBeNull();
  });
});
