/**
 * The plain-text snapshot of every screen under /app, for every role (workspace redesign, Batch 0).
 *
 * Captured from `main` BEFORE any markup changes. A look batch must leave the files in __text__/ unchanged: that is the proof
 * that only the look moved. Each scenario renders the real page component with the real parsers; only the API calls are
 * answered from fixtures (test/screens/state.ts). Sign-in, the clock, the time zone and the ids a page makes up are fixed.
 * To accept a deliberate change of words (the owner decides, never a batch alone): `npx vitest run test/screens -u`.
 */
import { render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SCENARIOS, ROLES } from "./scenarios";
import { screenText } from "./screen-text";
import { fixtureErrors, setHandlers } from "./state";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new (class extends Error {
      readonly to = to;
    })(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/session", async () => {
  const { session } = await import("./state");
  return { requireUser: async () => session.user, getUser: async () => session.user };
});
vi.mock("@/lib/api/client", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/client")>(), ["fetchMe", "fetchTenant"]));
vi.mock("@/lib/api/agents", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/agents")>(), ["fetchAgentSettings", "fetchRuns", "fetchClaims", "fetchAgentClaims", "fetchAgentCost"]));
vi.mock("@/lib/api/crm", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/crm")>(), ["fetchPage", "fetchCompany", "fetchContact", "fetchLead"]));
vi.mock("@/lib/api/enquiries", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/enquiries")>(), ["fetchLeadEnquiries", "fetchEnquiry", "fetchRequirement"]));
vi.mock("@/lib/api/erasure", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/erasure")>(), ["fetchErasureRequests", "fetchDataPolicy", "confirmationPhrase"]));
vi.mock("@/lib/api/evidence", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/evidence")>(), ["fetchEvidencePage"]));
vi.mock("@/lib/api/followups", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/followups")>(), ["fetchPolicyVersions", "fetchLeadFollowup", "fetchDueList", "fetchQuestionDrafts"]));
vi.mock("@/lib/api/item-types", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/item-types")>(), ["fetchItemTypes"]));
vi.mock("@/lib/api/lead-contact", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lead-contact")>(), ["fetchLeadContactId"]));
vi.mock("@/lib/api/leads", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/leads")>(), ["fetchReviewQueue", "fetchActiveIcpConfig"]));
vi.mock("@/lib/api/orders", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/orders")>(), ["fetchOrders", "fetchOrder", "fetchMembers"]));
vi.mock("@/lib/api/account", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/account")>(), ["fetchAccountSetup"]));
vi.mock("@/lib/api/plan", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/plan")>(), ["getPlan"]));
vi.mock("@/lib/api/today", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/today")>(), ["getToday", "getAiUsageToday", "getAgentsStatus"]));
vi.mock("@/lib/api/quote-policies", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quote-policies")>(), ["fetchQuotePolicyVersions"]));
vi.mock("@/lib/api/quotes", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quotes")>(), ["fetchQuoteSetup", "fetchEnquiryQuotes", "fetchQuote", "fetchQuoteText", "fetchQuotes"]));
vi.mock("@/lib/api/suppression", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/suppression")>(), ["fetchSuppressionStatus"]));

// The Office decides on the device which view to draw first (scene/capability.ts); the plain-text snapshot is the List, which every device can show.
vi.mock("@/components/v2/app/office/scene/capability", async (orig) => ({
  ...(await orig<typeof import("@/components/v2/app/office/scene/capability")>()),
  readClientEnv: () => ({ defaultView: "list", weak: true, webgl: false, reducedMotion: false, remembered: null, coarse: false, phone: false }),
}));

const DIR = path.join(import.meta.dirname, "__text__");
const savedTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "Asia/Kolkata";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:30"));
  vi.stubGlobal("crypto", { randomUUID: () => "77777777-7777-4777-8777-777777777777" });
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});
beforeEach(() => {
  setHandlers({});
});

async function capture(scenario: (typeof SCENARIOS)[number], role: (typeof ROLES)[number]): Promise<string> {
  const { session } = await import("./state");
  session.user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test", accessToken: "tok", aal: scenario.aal ?? (role === "owner" || role === "admin" ? "aal2" : "aal1"), hasSecondFactor: role === "owner" || role === "admin" };
  setHandlers(scenario.handlers(role));
  try {
    const element = await scenario.render();
    const { container } = render(element);
    return screenText(container);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_NOT_FOUND") return "[not found]\n";
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT:")) return `[redirect to ${error.message.slice("NEXT_REDIRECT:".length)}]\n`;
    throw error;
  }
}

describe("the text of every screen, for every role", () => {
  for (const scenario of SCENARIOS) {
    for (const role of scenario.roles ?? ROLES) {
      it(`${scenario.id} as ${role}`, async () => {
        const text = await capture(scenario, role);
        expect(fixtureErrors).toEqual([]);
        expect(text.length).toBeGreaterThan(0);
        await expect(text).toMatchFileSnapshot(path.join(DIR, `${scenario.id}.${role}.txt`));
      });
    }
  }
});

describe("the snapshot covers every screen", () => {
  const APP = path.join(import.meta.dirname, "../../app/app");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []));
  const source = fs.readFileSync(path.join(import.meta.dirname, "scenarios.tsx"), "utf8");

  it("has a scenario for every page.tsx under app/app (a new screen must be added to scenarios.tsx)", () => {
    const missing = walk(APP)
      .map((f) => `@/app/app/${path.relative(APP, f).replace(/\\/g, "/").replace(/\.tsx$/, "")}`.replace("@/app/app/page", "@/app/app/page"))
      .filter((imp) => !source.includes(`"${imp}"`));
    expect(missing).toEqual([]);
  });

  it("renders every scenario for the roles it lists, and the four roles for most", () => {
    expect(SCENARIOS.length).toBeGreaterThan(50);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });
});
