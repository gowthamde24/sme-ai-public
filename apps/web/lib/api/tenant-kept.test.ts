// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchTenant = vi.fn();
vi.mock("./client", () => ({ fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));

import { fetchTenantKept, forgetTenants } from "./tenant-kept";

const T = "22222222-2222-4222-8222-222222222222";
const tenant = (role: string) => ({ id: T, name: "Acme", role });

beforeEach(() => {
  forgetTenants();
  fetchTenant.mockReset();
});

describe("the workspace read kept 15 seconds for the small route handlers", () => {
  it("asks once per person and workspace inside 15 seconds (also when asked at the same moment), and again after", async () => {
    fetchTenant.mockResolvedValue(tenant("owner"));
    const [a, b] = await Promise.all([fetchTenantKept("tok", T, 1000), fetchTenantKept("tok", T, 1000)]);
    expect(a.role).toBe("owner");
    expect(b.role).toBe("owner");
    await fetchTenantKept("tok", T, 1000 + 14_999);
    expect(fetchTenant).toHaveBeenCalledTimes(1);
    fetchTenant.mockResolvedValue(tenant("sales"));
    expect((await fetchTenantKept("tok", T, 1000 + 15_001)).role).toBe("sales"); // (a changed role is seen after 15 s)
    expect(fetchTenant).toHaveBeenCalledTimes(2);
  });
  it("another person asks for themselves", async () => {
    fetchTenant.mockResolvedValueOnce(tenant("owner")).mockResolvedValueOnce(tenant("viewer"));
    expect((await fetchTenantKept("tok-a", T, 1)).role).toBe("owner");
    expect((await fetchTenantKept("tok-b", T, 1)).role).toBe("viewer");
  });
  it("a failed read (not a member: 404, a rejected session) is never kept", async () => {
    fetchTenant.mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce(tenant("owner"));
    await expect(fetchTenantKept("tok", T, 1)).rejects.toThrow("404");
    await Promise.resolve();
    expect((await fetchTenantKept("tok", T, 2)).role).toBe("owner");
    expect(fetchTenant).toHaveBeenCalledTimes(2);
  });
});
