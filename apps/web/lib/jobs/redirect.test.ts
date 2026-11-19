import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mode: { v: "mock" as "off" | "mock" | "on" }, read: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));
vi.mock("@/lib/api/jobs", () => ({ readJobs: (...a: unknown[]) => h.read(...a) }));

import { MOCK_JOBS } from "./mock";
import { ALL_SETTINGS, officeToJobs, redirectToJob } from "./redirect";

const T = "22222222-2222-4222-8222-222222222222";
const speed = MOCK_JOBS.find((j) => j.kind === "speed_to_lead")!;
beforeEach(() => {
  h.mode.v = "mock";
  h.read.mockReset().mockResolvedValue([...MOCK_JOBS]);
});

describe("old pages with JOBS on", () => {
  it("JOBS OFF: nothing changes, the jobs are not even asked for", async () => {
    h.mode.v = "off";
    await expect(redirectToJob("tok", T, "speed_to_lead", undefined)).resolves.toBeUndefined();
    expect(h.read).not.toHaveBeenCalled();
  });
  it("JOBS ON: Rules go to the speed-to-lead job; a page with no job of its own goes to the Jobs page", async () => {
    await expect(redirectToJob("tok", T, "speed_to_lead", undefined)).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs/${speed.id}`);
    await expect(redirectToJob("tok", T, null, undefined)).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs`);
    h.read.mockResolvedValue(MOCK_JOBS.filter((j) => j.kind !== "payment_reminders"));
    await expect(redirectToJob("tok", T, "payment_reminders", undefined)).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs`);
  });
  it("?all=1 opens the old page (the job page's All settings link): no redirect, so no feature is lost and there is no loop", async () => {
    await expect(redirectToJob("tok", T, "speed_to_lead", "1")).resolves.toBeUndefined();
    expect(Object.values(ALL_SETTINGS).every((p) => p?.endsWith("?all=1"))).toBe(true);
  });
  it("an API that has no jobs yet leaves the old page where it is", async () => {
    h.read.mockResolvedValue(null);
    await expect(redirectToJob("tok", T, "speed_to_lead", undefined)).resolves.toBeUndefined();
  });
});

describe("Office and My AI team with JOBS on (forever: no end date)", () => {
  it("JOBS OFF: nothing changes, the old address keeps its page", () => {
    h.mode.v = "off";
    expect(() => officeToJobs(T)).not.toThrow();
  });
  it("JOBS ON (mock or 1): the old Office / AI team address leads to the Jobs page of that workspace, every time", () => {
    for (const mode of ["mock", "on"] as const) {
      h.mode.v = mode;
      expect(() => officeToJobs(T)).toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs`);
    }
  });
  it("the two old landing pages call it before anything else is read (a redirect, not a page)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../../app/app/tenants/[tenantId]");
    for (const page of ["office/page.tsx", "ai-team/page.tsx"]) {
      const src = readFileSync(path.join(dir, page), "utf8");
      expect(src, page).toMatch(/officeToJobs\(tenantId\)/);
      expect(src.indexOf("officeToJobs(tenantId)"), page).toBeLessThan(src.indexOf("fetchTenant(user") === -1 ? Infinity : src.indexOf("fetchTenant(user"));
    }
  });
});
