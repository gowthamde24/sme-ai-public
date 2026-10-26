import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tenant: vi.fn(), provider: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/22222222-2222-4222-8222-222222222222/orders", useSearchParams: () => new URLSearchParams() }));
vi.mock("./today-read", () => ({ readAgentsCached: async () => [{ agent: "main", state: "idle" }], readAccessCached: async () => ({ readOnly: false }) }));
vi.mock("../../frame-data", () => ({ readFrameData: async () => (await import("@/components/v2/app/contract")).NO_FRAME_DATA }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", accessToken: "tok", email: "a@b.test" }) }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/components/v2/app/today/ask/AskProvider", () => ({ AskProvider: (p: { children: React.ReactNode }) => (h.provider(p), p.children) }));
vi.mock("@/components/v2/app/frame-store", async (orig) => ({ ...(await orig<typeof import("@/components/v2/app/frame-store")>()), FrameDataSlot: () => null }));

import TenantLayout from "./layout";

const T = "22222222-2222-4222-8222-222222222222";
const props = { children: <p>page</p>, params: Promise.resolve({ tenantId: T }) } as unknown as Parameters<typeof TenantLayout>[0];
const doIt = () => h.provider.mock.calls.at(-1)?.[0].doIt;

beforeEach(() => {
  h.tenant.mockReset();
  h.provider.mockClear();
  vi.unstubAllEnvs();
  h.tenant.mockResolvedValue({ role: "owner" });
});

describe("'Do it' in the workspace's one conversation (night 4, tasks)", () => {
  it("is not offered, and the role is not even read, while TASK_SCREENS is off", async () => {
    render(await TenantLayout(props));
    expect(doIt()).toBeNull();
    expect(h.tenant).not.toHaveBeenCalled();
  });
  it.each([["mock"], ["1"]])("is offered to Owner, Admin and Sales when TASK_SCREENS=%s, with the actions, the powers and only the task words", async (flag) => {
    vi.stubEnv("TASK_SCREENS", flag);
    for (const [role, approve] of [["owner", true], ["admin", false], ["sales", false]] as const) {
      h.tenant.mockResolvedValue({ role });
      render(await TenantLayout(props));
      const d = doIt();
      expect(d.powers).toEqual({ plan: true, approve, move: role !== "sales" });
      expect(Object.keys(d.actions).sort()).toEqual(["answer", "approve", "cancel", "exclude", "pause", "plan", "progress", "report", "resume", "run", "setCap", "templates"]);
      expect(Object.keys(d.words).every((k) => k.startsWith("tk.") || k.startsWith("pc."))).toBe(true);
      expect(d.words["tk.d.do"]).toBe("Do it");
    }
  });
  it("is left out for a Viewer and when the role cannot be read", async () => {
    vi.stubEnv("TASK_SCREENS", "mock");
    h.tenant.mockResolvedValue({ role: "viewer" });
    render(await TenantLayout(props));
    expect(doIt()).toBeNull();
    h.tenant.mockRejectedValue(new Error("down"));
    render(await TenantLayout(props));
    expect(doIt()).toBeNull();
  });
});
