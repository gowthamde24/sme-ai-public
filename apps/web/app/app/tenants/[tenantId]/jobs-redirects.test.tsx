import { beforeEach, describe, expect, it, vi } from "vitest";

const T = "22222222-2222-4222-8222-222222222222";
const ctx = { ok: true as const, ctx: { accessToken: "tok", userId: "u", tenant: { role: "owner" }, pack: null } };
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("./lead-context", () => ({ leadContext: async () => ctx }));
vi.mock("./campaigns/prelude", () => ({ campaignContext: async () => ctx }));
vi.mock("@/lib/api/jobs", async (orig) => ({ ...(await orig<typeof import("@/lib/api/jobs")>()), readJobs: async () => (await import("@/lib/jobs/mock")).MOCK_JOBS.slice() }));

import { MOCK_JOBS } from "@/lib/jobs/mock";

import CampaignsRoute from "./campaigns/page";
import OutreachPage from "./outreach/page";
import OutreachRulesPage from "./outreach/rules/page";

const speed = MOCK_JOBS.find((j) => j.kind === "speed_to_lead")!;
const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: T }), searchParams: Promise.resolve(search) }) as never;
beforeEach(() => {
  process.env.JOBS = "mock";
});

describe("every old landing page with JOBS on lands on a job or the Jobs page", () => {
  it("Rules -> the speed-to-lead job", async () => {
    await expect(OutreachRulesPage(props())).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs/${speed.id}`);
  });
  it("Campaigns -> the Jobs page", async () => {
    await expect(OutreachPage(props())).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs`);
  });
  it("Payment reminders (campaigns) -> the payment-reminders job", async () => {
    const pay = MOCK_JOBS.find((j) => j.kind === "payment_reminders")!;
    await expect(CampaignsRoute(props())).rejects.toThrow(`NEXT_REDIRECT:/app/tenants/${T}/jobs/${pay.id}`);
  });
});
