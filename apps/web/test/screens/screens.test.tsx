/**
 * The plain-text snapshot of every screen under /app, for every role (workspace redesign, Batch 0).
 *
 * Captured from `main` BEFORE any markup changes. A look batch must leave the files in __text__/ unchanged: that is the proof
 * that only the look moved. Each scenario renders the real page component with the real parsers; only the API calls are
 * answered from fixtures (test/screens/state.ts). Sign-in, the clock, the time zone and the ids a page makes up are fixed.
 * To accept a deliberate change of words (the owner decides, never a batch alone): `npx vitest run test/screens -u`.
 */
import { act, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SCENARIOS, ROLES } from "./scenarios";
import { screenText } from "./screen-text";
import { fixtureErrors, setHandlers } from "./state";

// a lazy chunk (next/dynamic) may or may not have arrived when the snapshot is taken: draw the form itself, always
// night 4 F2: the same for the lazy top-up controls of the Plan part
vi.mock("@/components/v2/app/topups/LazyTopups", async () => ({ TopupControls: (await import("@/components/v2/app/topups/TopupControls")).TopupControls }));
vi.mock("@/components/v2/app/assistant/LazyCallSettingsAdvanced", async () => ({ CallSettingsAdvanced: (await import("@/components/v2/app/assistant/CallSettingsAdvanced")).CallSettingsAdvanced }));
vi.mock("@/lib/api/outreach", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/outreach")>(), ["listBatches", "getBatch", "getBatchItems", "listRules", "listHandoffs", "getOutreachReport", "getPolicy"]));
vi.mock("@/lib/api/lead-desk", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lead-desk")>(), ["listDeskLeads", "getTouches"]));
vi.mock("@/components/v2/app/lead-desk/LazyImportScreen", async () => ({ LazyImportScreen: (await import("@/components/v2/app/lead-desk/ImportScreen")).ImportScreen }));
vi.mock("@/components/v2/app/lead-desk/LazyLeadSources", async () => ({ LazyLeadSources: (await import("@/components/v2/app/lead-desk/LeadSources")).LeadSources }));
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
vi.mock("@/lib/api/today", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/today")>(), ["getToday", "getAgentsStatus"]));
vi.mock("@/lib/api/outbox", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/outbox")>(), ["listOutboxMessages", "listOutboxApprovals", "listCallRequests", "getOutboxSettings", "getOutboxSummary"]));
vi.mock("@/lib/api/visits", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/visits")>(), ["getTodayVisits", "getSlots", "getVisitSettings", "listVisits", "getAiUsageWeek"]));
vi.mock("@/lib/api/catalogue", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/catalogue")>(), ["listCatalogueItems", "getCatalogueItem"]));
vi.mock("@/lib/api/scheduler", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/scheduler")>(), ["getSchedulerStatus", "getSchedulerSettings"]));
vi.mock("@/lib/api/ai-usage", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/ai-usage")>(), ["getAiUsage"]));
vi.mock("@/lib/api/quote-policies", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quote-policies")>(), ["fetchQuotePolicyVersions"]));
vi.mock("@/lib/api/quotes", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quotes")>(), ["fetchQuoteSetup", "fetchEnquiryQuotes", "fetchQuote", "fetchQuoteText", "fetchQuotes"]));
vi.mock("@/lib/api/data", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/data")>(), ["getCalendarFeed", "getExportFormats", "listImportJobs"]));
vi.mock("@/lib/api/privacy", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/privacy")>(), ["listMyExports", "listMyDeletions", "listWorkspaceDeletions"]));
vi.mock("@/lib/api/consent-list", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/consent-list")>(), ["readConsentList"]));
vi.mock("@/lib/api/retailers", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/retailers")>(), ["getResearchStatus"]));
vi.mock("@/lib/api/team", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/team")>(), ["getTeam", "listInvitations"]));
vi.mock("@/lib/api/whatsapp", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/whatsapp")>(), ["getWhatsappAccount", "listTemplates", "listConversations", "getThread"]));
vi.mock("@/lib/api/gstin", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/gstin")>(), ["getBusinessProfile"]));
vi.mock("@/lib/api/policy", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/policy")>(), ["getPolicyStatus"]));
vi.mock("@/lib/api/pack", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/pack")>(), ["getWorkspacePack", "getAccountSecurity"]));
vi.mock("@/lib/api/custom-fields", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/custom-fields")>(), ["listCustomFields", "getCatalogueCustom", "getContactCustom"]));
vi.mock("@/lib/api/example-data", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/example-data")>(), ["getExampleStatus"]));
vi.mock("@/lib/api/profile", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/profile")>(), ["getProfile"]));
vi.mock("@/lib/api/materials", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/materials")>(), ["getMaterialPolicy", "listMaterialItems", "getMaterialItem", "listMaterialQuotes", "getMaterialQuote", "getMaterialQuoteText"]));
vi.mock("@/lib/api/sites", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/sites")>(), ["listSites", "getSite"]));
vi.mock("@/lib/api/deliveries", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/deliveries")>(), ["listTrips", "getTrip", "getChallan", "listOrderTrips"]));
vi.mock("@/lib/api/ledger", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/ledger")>(), ["getLedgerSummary", "getLedgerStatement", "getLedgerEntries", "getLedgerReceipt"]));
vi.mock("@/lib/api/campaigns", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/campaigns")>(), ["listCampaigns", "getCampaign", "getPreview", "listRecipients", "getResults", "getCallList"]));
vi.mock("@/lib/api/education", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/education")>(), ["getInstitutionProfile", "listProgrammes", "listStudents", "getStudent", "listAdmissions", "getAdmission", "listFeePlans", "getFeePlan", "getStudentFees", "getStudentFeeEntries", "getFeeReceipt", "getGuardianFees", "getLateFeesPreview", "listPending"]));
vi.mock("@/lib/api/reports", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/reports")>(), ["runReport", "getReportCatalogue"]));
vi.mock("@/lib/api/contact-names", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/contact-names")>(), ["listContactNames"]));
vi.mock("@/lib/api/suppression", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/suppression")>(), ["fetchSuppressionStatus"]));

// The Office decides on the device which view to draw first (office/view.ts); the plain-text snapshot is the List, which every device can show.
vi.mock("@/components/v2/app/office/view", async (orig) => ({
  ...(await orig<typeof import("@/components/v2/app/office/view")>()),
  readClientEnv: () => ({ reducedMotion: false, lite: false, remembered: "list" }),
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
    // rendered inside an awaited act, so the parts that read a promise (the outbox log under its Suspense) have settled when the text is taken
    let container!: HTMLElement;
    await act(async () => {
      container = render(element).container;
    });
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

describe("the default business type is the product as it was (job CL: textiles must look exactly as today)", () => {
  it("Today of a workspace that runs the default business type, with its pack read from the API, reads exactly like Today with no pack at all", async () => {
    const fs = await import("node:fs");
    const read = (id: string) => fs.readFileSync(path.join(DIR, `${id}.owner.txt`), "utf8");
    expect(read("today-default-pack")).toBe(read("today"));
  });
});

describe("the example data offer (night 4 clean-up)", () => {
  it("is drawn for a business type that ships example data and not for one that ships none (it would load an empty batch)", async () => {
    const fs = await import("node:fs");
    const read = (id: string) => fs.readFileSync(path.join(DIR, `${id}.owner.txt`), "utf8");
    expect(read("today-construction")).toMatch(/example data/i);
    expect(read("today-no-example-data")).not.toMatch(/example data/i);
    expect(read("today-no-example-data")).not.toMatch(/fee-reminder/i); // a fee-reminder campaign is the first step of a school only
    expect(read("today-education-example-loaded")).toMatch(/fee-reminder/i);
  });
});
