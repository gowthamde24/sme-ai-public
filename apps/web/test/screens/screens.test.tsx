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
import { callLog, fixtureErrors, setHandlers } from "./state";

// a lazy chunk (next/dynamic) may or may not have arrived when the snapshot is taken: draw the form itself, always
// night 4 F2: the same for the lazy top-up controls of the Plan part
// JOBS (the simplicity pass, Settings group A): the sentence versions of Business, Language and theme, Notifications and Team are lazy chunks on a real page; the snapshot draws them at once
vi.mock("@/components/v2/app/settings/simple/Lazy", async () => ({ BusinessSimple: (await import("@/components/v2/app/settings/simple/BusinessSimple")).BusinessSimple, LanguageSimple: (await import("@/components/v2/app/settings/simple/LanguageSimple")).LanguageSimple, NotificationsSimple: (await import("@/components/v2/app/settings/simple/NotificationsSimple")).NotificationsSimple, TeamMembersSimple: (await import("@/components/v2/app/settings/simple/TeamSimple")).TeamMembersSimple, InviteSimple: (await import("@/components/v2/app/settings/simple/TeamSimple")).InviteSimple }));
vi.mock("@/components/v2/app/jobs/rules/LazyRulesSimple", async () => ({ RulesSimple: (await import("@/components/v2/app/jobs/rules/RulesSimple")).RulesSimple }));
vi.mock("@/components/v2/app/settings/LazyAssistantNameCard", async () => ({ AssistantNameCard: (await import("@/components/v2/app/settings/AssistantNameCard")).AssistantNameCard }));
vi.mock("@/components/v2/app/settings/LazyDeveloperKeys", async () => ({ DeveloperKeysCard: (await import("@/components/v2/app/settings/DeveloperKeysCard")).DeveloperKeysCard }));
// the plain-sentence pages (JOBS, the simplicity pass): their lazy chunks are drawn at once in the snapshot
vi.mock("@/components/v2/app/jobs/pages/LazyLinkSentence", async () => ({ LinkSentence: (await import("@/components/v2/app/jobs/pages/LinkSentence")).LinkSentence }));
vi.mock("@/components/v2/app/catalogue/LazyItemFieldsSimple", async () => ({ ItemFieldsSimple: (await import("@/components/v2/app/catalogue/ItemFieldsSimple")).ItemFieldsSimple }));
vi.mock("@/components/v2/app/jobs/rules/LazyPolicySentences", async () => ({ PolicySentences: (await import("@/components/v2/app/jobs/rules/PolicySentences")).PolicySentences }));
// JOBS (What you sell): the list and its sheet are lazy chunks on a real page; the snapshot draws the list at once
vi.mock("@/components/v2/app/sell/LazySection", async () => ({ SellSection: (await import("@/components/v2/app/sell/SellSection")).SellSection }));
vi.mock("@/components/v2/app/jobs/LazyJobRow", async () => ({ JobRow: (await import("@/components/v2/app/jobs/JobRow")).JobRow }));
vi.mock("@/components/v2/app/jobs/detail/LazyJobLists", async () => ({
  ...(await import("@/components/v2/app/jobs/detail/JobLists")),
  FailureCard: (await import("@/components/v2/app/jobs/detail/JobFailure")).FailureCard,
  JobRenameForm: (await import("@/components/v2/app/jobs/detail/JobRenameForm")).JobRenameForm,
  TryCard: (await import("@/components/v2/app/jobs/detail/JobTry")).TryCard,
  WhoTalks: (await import("@/components/v2/app/jobs/detail/WhoTalks")).WhoTalks,
}));
vi.mock("@/components/v2/app/whatsapp/builder/LazyOwnMessages", async () => ({ OwnMessages: (await import("@/components/v2/app/whatsapp/builder/OwnMessages")).OwnMessages }));
vi.mock("@/components/v2/app/whatsapp/LazyConnectWithFacebook", async () => (await import("@/components/v2/app/whatsapp/ConnectWithFacebook")));
// (the small briefing read of Today: "not told" here, so the screens keep drawing their briefing from the big reads as they were taken)
vi.mock("@/lib/api/today-briefing", async (orig) => ({ ...(await orig<typeof import("@/lib/api/today-briefing")>()), getTodayBriefing: async () => null }));
// the New job sheet (JOBS, mocks r3-01 and r3-02): the sheet, the empty page's three cards and Today's festival suggestion are lazy chunks on a real page; the snapshot draws them at once
vi.mock("@/components/v2/app/jobs/sheet/LazySheet", async () => ({ loadSheet: async () => undefined, SheetVeil: () => null, LazySheet: (await import("@/components/v2/app/jobs/sheet/NewJobSheet")).default }));
vi.mock("@/components/v2/app/jobs/sheet/LazyJobsEmpty", async () => ({ JobsEmpty: (await import("@/components/v2/app/jobs/sheet/JobsEmpty")).JobsEmpty }));
vi.mock("@/components/v2/app/jobs/sheet/LazyFestival", async () => ({ FestivalSuggestion: (await import("@/components/v2/app/jobs/sheet/FestivalSuggestion")).FestivalSuggestion }));
vi.mock("@/components/v2/app/jobs/LazySearchPlan", async () => ({ SearchPlan: (await import("@/components/v2/app/jobs/SearchPlan")).SearchPlan }));
vi.mock("@/components/v2/app/jobs/LazyPlanCard", async () => ({ PlanCard: (await import("@/components/v2/app/jobs/PlanCard")).PlanCard }));
vi.mock("@/components/v2/app/prospects/LazyResearcherCard", async () => ({ ResearcherCard: (await import("@/components/v2/app/prospects/ResearcherCard")).ResearcherCard }));
vi.mock("@/components/v2/app/prospects/LazyMarkContacted", async () => ({ MarkContacted: (await import("@/components/v2/app/prospects/MarkContacted")).MarkContacted }));
vi.mock("@/components/v2/app/topups/LazyTopups", async () => ({ TopupControls: (await import("@/components/v2/app/topups/TopupControls")).TopupControls }));
vi.mock("@/components/v2/app/settings/LazyAssistantActivity", async () => ({ AssistantActivity: (await import("@/components/v2/app/settings/AssistantActivity")).AssistantActivity }));
vi.mock("@/components/v2/app/prospects/LazyFinderSettingsForm", async () => ({ FinderSettingsForm: (await import("@/components/v2/app/prospects/FinderSettingsForm")).FinderSettingsForm }));
vi.mock("@/components/v2/app/assistant/LazyCallSettingsAdvanced", async () => ({ CallSettingsAdvanced: (await import("@/components/v2/app/assistant/CallSettingsAdvanced")).CallSettingsAdvanced }));
vi.mock("@/lib/api/outreach", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/outreach")>(), ["listBatches", "getBatch", "getBatchItems", "listRules", "listHandoffs", "getOutreachReport", "getPolicy"]));
vi.mock("@/lib/api/lead-desk", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lead-desk")>(), ["listDeskLeads", "getTouches", "listLeadArrivals"]));
// design system v6 (Today): the band, the day-one checklist, "Your day" and "Your assistant is working on" are lazy chunks on a real page; the snapshot draws them at once (the phone's bottom bar is client-only: nothing in the text)
vi.mock("@/components/v2/app/today/v6/LazyTodayBand", async () => ({ LazyTodayBand: (await import("@/components/v2/app/today/v6/TodayBand")).TodayBand, LazyTodayBandAfter: () => null }));
vi.mock("@/components/v2/app/today/v6/day-one/LazyDayOne", async () => ({ LazyDayOne: (await import("@/components/v2/app/today/v6/day-one/DayOne")).default }));
vi.mock("@/components/v2/app/today/v6/LazyYourDay", async () => ({ LazyYourDay: (await import("@/components/v2/app/today/v6/YourDay")).default }));
vi.mock("@/components/v2/app/today/v6/LazyWorkingOn", async () => ({ LazyWorkingOn: (await import("@/components/v2/app/today/v6/WorkingOn")).default }));
vi.mock("@/components/v2/app/lead-desk/LazyImportScreen", async () => ({ LazyImportScreen: (await import("@/components/v2/app/lead-desk/ImportScreen")).ImportScreen }));
vi.mock("@/components/v2/app/ds/LazyFileField", async () => ({ LazyFileField: (await import("@/components/v2/app/ds/FileField")).FileField }));
vi.mock("@/components/v2/app/today/ask/work/LazyWorkPreview", async () => ({ WorkPreview: (await import("@/components/v2/app/today/ask/work/WorkPreview")).WorkPreview }));
// My assistant (design system v6): its interactive parts, and the working parts of Settings it reuses, are lazy chunks on a real page; the snapshot draws them itself
vi.mock("@/components/v2/app/my-assistant/LazyMyAssistant", async () => ({
  PracticePanel: (await import("@/components/v2/app/my-assistant/PracticePanel")).PracticePanel,
  VoiceCard: (await import("@/components/v2/app/my-assistant/VoiceCard")).VoiceCard,
  VoiceTone: (await import("@/components/v2/app/my-assistant/VoiceTone")).VoiceTone,
  TalkToYou: (await import("@/components/v2/app/my-assistant/TalkToYou")).TalkToYou,
  KnowledgeStep: (await import("@/components/v2/app/lead-setup/KnowledgeStep")).KnowledgeStep,
}));
// Settings, Quotes (J39): the two policy forms are lazy chunks on a real page; the snapshot draws them itself
vi.mock("@/components/v2/app/campaigns/LazyOffer", async () => ({ OfferForm: (await import("@/components/v2/app/campaigns/OfferForm")).OfferForm, OfferAudience: (await import("@/components/v2/app/campaigns/OfferAudience")).OfferAudience }));
vi.mock("@/components/v2/app/materials/LazyPolicyForm", async () => ({ PolicyForm: (await import("@/components/v2/app/materials/PolicyForm")).PolicyForm }));
vi.mock("@/app/app/tenants/[tenantId]/quote-policy/LazyQuotePolicyForm", async () => ({ QuotePolicyForm: (await import("@/app/app/tenants/[tenantId]/quote-policy/quote-policy-form")).QuotePolicyForm }));
vi.mock("@/components/v2/app/assistant/LazyAboutBusiness", async () => ({ AboutBusiness: (await import("@/components/v2/app/assistant/AboutBusiness")).AboutBusiness }));
vi.mock("@/components/v2/app/assistant/LazyAutoReply", async () => ({ AutoReply: (await import("@/components/v2/app/assistant/AutoReply")).AutoReply }));
vi.mock("@/components/v2/app/assistant/LazyTakeOverSwitch", async () => ({ TakeOverSwitch: (await import("@/components/v2/app/assistant/TakeOverSwitch")).TakeOverSwitch }));
vi.mock("@/components/v2/app/assistant/LazyTalkTraining", async () => ({ TalkTraining: (await import("@/components/v2/app/assistant/TalkTraining")).TalkTraining }));
vi.mock("@/components/v2/app/lead-desk/LazyLeadSources", async () => ({ LazyLeadSources: (await import("@/components/v2/app/lead-desk/LeadSources")).LeadSources }));
// design system v6 (calls-chats): the lazy chunks of the Calls and Chats pages are drawn at once in the snapshot
vi.mock("@/components/v2/app/calls/v6/Lazy", async () => ({ LiveStrip: (await import("@/components/v2/app/calls/v6/LiveStrip")).LiveStrip, PanelIslands: (await import("@/components/v2/app/calls/v6/PanelIslands")).PanelIslands, Repoll: () => null }));
vi.mock("@/components/v2/app/calls/v6/LazyLive", async () => ({ LiveControls: (await import("@/components/v2/app/calls/v6/LiveControls")).LiveControls }));
vi.mock("@/components/v2/app/chats/v6/Lazy", async () => ({ Conversation: (await import("@/components/v2/app/chats/v6/Conversation")).Conversation, QuoteOutcome: (await import("@/components/v2/app/ds/QuoteOutcome")).QuoteOutcome }));
vi.mock("@/components/v2/app/chats/v6/queue/LazyQueueComposer", async () => ({ QueueComposer: (await import("@/components/v2/app/chats/v6/queue/QueueComposer")).QueueComposer }));
vi.mock("@/lib/api/chat-queue", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/chat-queue")>(), ["readQueued"]));
// the Reports page: its charts and the Download PDF button are a lazy chunk on a real page; the snapshot draws them at once
vi.mock("@/components/v2/app/report-v6/Lazy", async () => ({ EnquiryChart: (await import("@/components/v2/app/report-v6/charts")).EnquiryChart, SalesChart: (await import("@/components/v2/app/report-v6/charts")).SalesChart, PrintButton: (await import("@/components/v2/app/report-v6/charts")).PrintButton }));
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
vi.mock("@/components/v2/app/calls/LazyTestCallIntroduce", async () => ({ TestCallIntroduce: (await import("@/components/v2/app/calls/TestCallIntroduce")).TestCallIntroduce }));
vi.mock("@/lib/api/talk-training", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/talk-training")>(), ["getTalkTraining"]));
vi.mock("@/lib/api/agents", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/agents")>(), ["fetchAgentSettings", "fetchRuns", "fetchClaims", "fetchAgentClaims", "fetchAgentCost"]));
vi.mock("@/lib/api/crm", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/crm")>(), ["fetchPage", "fetchCompany", "fetchContact", "fetchLead"]));
vi.mock("@/lib/api/activity-log", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/activity-log")>(), ["listActivityLog"]));
vi.mock("@/lib/api/calls", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/calls")>(), ["listCalls", "getCall", "listTestNumbers"]));
vi.mock("@/lib/api/customer-timeline", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/customer-timeline")>(), ["fetchCustomerHead", "fetchTimeline"]));
vi.mock("@/lib/api/enquiries", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/enquiries")>(), ["fetchLeadEnquiries", "fetchEnquiry", "fetchRequirement"]));
vi.mock("@/lib/api/erasure", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/erasure")>(), ["fetchErasureRequests", "fetchDataPolicy", "confirmationPhrase"]));
vi.mock("@/lib/api/evidence", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/evidence")>(), ["fetchEvidencePage"]));
vi.mock("@/lib/api/followups", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/followups")>(), ["fetchPolicyVersions", "fetchLeadFollowup", "fetchDueList", "fetchQuestionDrafts"]));
vi.mock("@/lib/api/item-types", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/item-types")>(), ["fetchItemTypes"]));
vi.mock("@/lib/api/pricelists", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/pricelists")>(), ["fetchLoadedPriceList"]));
vi.mock("@/lib/api/lead-contact", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lead-contact")>(), ["fetchLeadContactId"]));
vi.mock("@/lib/api/leads", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/leads")>(), ["fetchReviewQueue", "fetchActiveIcpConfig"]));
vi.mock("@/lib/api/orders", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/orders")>(), ["fetchOrders", "fetchOrder", "fetchMembers"]));
vi.mock("@/lib/api/account", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/account")>(), ["fetchAccountSetup"]));
vi.mock("@/lib/api/plan", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/plan")>(), ["getPlan"]));
vi.mock("@/lib/api/today", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/today")>(), ["getToday", "getAgentsStatus"]));
vi.mock("@/lib/api/outbox", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/outbox")>(), ["listOutboxMessages", "listOutboxApprovals", "listCallRequests", "getOutboxSettings", "getOutboxSummary"]));
vi.mock("@/lib/api/visits", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/visits")>(), ["getTodayVisits", "getSlots", "getVisitSettings", "listVisits", "getAiUsageWeek"]));
vi.mock("@/lib/api/catalogue", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/catalogue")>(), ["listCatalogueItems", "getCatalogueItem", "getLowStock"]));
vi.mock("@/lib/api/scheduler", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/scheduler")>(), ["getSchedulerStatus", "getSchedulerSettings"]));
vi.mock("@/lib/api/ai-usage", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/ai-usage")>(), ["getAiUsage"]));
vi.mock("@/lib/api/quote-policies", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quote-policies")>(), ["fetchQuotePolicyVersions"]));
vi.mock("@/lib/api/quotes", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/quotes")>(), ["fetchQuoteSetup", "fetchEnquiryQuotes", "fetchQuote", "fetchQuoteText", "fetchQuotes"]));
vi.mock("@/lib/api/data", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/data")>(), ["getCalendarFeed", "getExportFormats", "listImportJobs"]));
vi.mock("@/lib/api/privacy", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/privacy")>(), ["listMyExports", "listMyDeletions", "listWorkspaceDeletions"]));
vi.mock("@/lib/api/consent-list", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/consent-list")>(), ["readConsentList"]));
vi.mock("@/lib/api/lead-finder", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lead-finder")>(), ["readAvailability", "redecideProspects", "listProspects", "getProspectStats", "getProspect", "getFinderSettings", "listSearches"]));
vi.mock("@/lib/api/team", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/team")>(), ["getTeam", "listInvitations"]));
vi.mock("@/lib/api/whatsapp", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/whatsapp")>(), ["getWhatsappAccount", "getConnectConfig", "listTemplates", "listConversations", "getThread", "listChatTemplates"]));
vi.mock("@/lib/api/lists", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/lists")>(), ["getLists", "getList", "getRows"]));
vi.mock("@/lib/api/numbers", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/numbers")>(), ["listOwn"]));
vi.mock("@/lib/api/gstin", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/gstin")>(), ["getBusinessProfile"]));
vi.mock("@/lib/api/policy", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/policy")>(), ["getPolicyStatus"]));
vi.mock("@/lib/api/pack", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/pack")>(), ["getWorkspacePack", "getAccountSecurity", "listPacks"]));
vi.mock("@/lib/api/custom-fields", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/custom-fields")>(), ["listCustomFields", "getCatalogueCustom", "getContactCustom"]));
vi.mock("@/lib/api/example-data", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/example-data")>(), ["getExampleStatus"]));
vi.mock("@/lib/api/workspace", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/workspace")>(), ["getWorkspaceProfile"]));
vi.mock("@/lib/api/me", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/me")>(), ["getMyProfile", "getPeople"]));
vi.mock("@/lib/api/profile", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/profile")>(), ["getProfile"]));
vi.mock("@/lib/api/materials", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/materials")>(), ["getMaterialPolicy", "listMaterialItems", "getMaterialItem", "listMaterialQuotes", "getMaterialQuote", "getMaterialQuoteText"]));
vi.mock("@/lib/api/sites", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/sites")>(), ["listSites", "getSite"]));
vi.mock("@/lib/api/deliveries", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/deliveries")>(), ["listTrips", "getTrip", "getChallan", "listOrderTrips"]));
vi.mock("@/lib/api/money", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/money")>(), ["getMoneySummary"]));
vi.mock("@/lib/api/ledger", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/ledger")>(), ["getLedgerSummary", "getLedgerStatement", "getLedgerEntries", "getLedgerReceipt"]));
vi.mock("@/lib/api/campaigns", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/campaigns")>(), ["listCampaigns", "getCampaign", "getPreview", "listRecipients", "getResults", "getCallList"]));
vi.mock("@/lib/api/marketing-consent", async (orig) => (await import("./state")).wrap(await orig<typeof import("@/lib/api/marketing-consent")>(), ["listMarketingConsent"]));
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
  // the flags of a scenario stay on until the text is taken: a page that draws in parts reads the rest of its data after `render` has returned
  const env = process.env as Record<string, string | undefined>;
  const before = Object.fromEntries(Object.keys(scenario.env ?? {}).map((k) => [k, env[k]]));
  Object.assign(env, scenario.env ?? {});
  try {
    const element = await scenario.render();
    // rendered inside an awaited act, so the parts that read a promise (the outbox log under its Suspense) have settled when the text is taken
    let container!: HTMLElement;
    await act(async () => {
      container = render(element).container;
    });
    // Today and Leads draw in parts that finish one after another: wait until it has not changed for three rounds of the clock (one awaited act was not enough on a loaded machine, where the lazy modules load slower)
    const streams = scenario.env !== undefined || /^(today|lead-desk|phone-call-test)/.test(scenario.id);
    const started = Date.now();
    for (let round = 0, before = "", still = 0; streams && round < 400; round += 1) {
      await act(async () => void (await new Promise((r) => setTimeout(r, round < 2 ? 0 : 5))));
      const now = container.innerHTML;
      still = now === before ? still + 1 : 0;
      before = now;
      // done when nothing is waiting for its data any more and the page has not changed for three rounds (a part whose data never comes keeps its placeholder: give up after two seconds)
      if (still >= 3 && (container.querySelector("[data-placeholder]") === null || Date.now() - started > 2000)) break;
    }
    return screenText(container);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_NOT_FOUND") return "[not found]\n";
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT:")) return `[redirect to ${error.message.slice("NEXT_REDIRECT:".length)}]\n`;
    throw error;
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
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
      .map((f) => `@/app/app/${path.relative(APP, f).replace(/\\/g, "/").replace(/\.tsx$/, "")}`)
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

describe("Today with nothing waiting, for the business types with their own pages, with the Lead Desk parts on (the staging crash)", () => {
  it.each(["textiles", "construction", "education"])("%s: the page is drawn (no 'Something went wrong'), no Lead Desk card or worker, and 'My AI team' is the shop's helpers, never the Lead Desk workers", async (name) => {
    const fs = await import("node:fs");
    for (const role of ["owner", "admin"]) {
      const text = fs.readFileSync(path.join(DIR, `today-empty-${name}.${role}.txt`), "utf8");
      expect(text).toMatch(/Needs you/);
      expect(text).not.toMatch(/Something went wrong|Hot lead|Plan to approve/);
      expect(text).not.toMatch(/Lead catcher|Standing rules|Task helper/);
      expect(text).toMatch(/Office/);
    }
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

describe("Today reads each thing once, however the page is drawn", () => {
  // The calls (by name, at most) the page made when it waited for all of its data, taken before it drew in parts (19 Nov 2026). A test has no request, so nothing is remembered between two askers of the same thing; the real page asks each once.
  const BEFORE: Record<string, Record<string, number>> = {
  "today-v6/owner": { fetchMembers: 1, fetchQuotes: 2, fetchTenant: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getExampleStatus: 1, getMyProfile: 1, getOutboxSettings: 1, getProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 4, listCallRequests: 1, listOutboxApprovals: 1, listOutboxMessages: 1, listVisits: 2, readAvailability: 3 },
  "today-v6/admin": { fetchMembers: 1, fetchQuotes: 2, fetchTenant: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getExampleStatus: 1, getMyProfile: 1, getOutboxSettings: 1, getProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 4, listOutboxApprovals: 1, listOutboxMessages: 1, listVisits: 2, readAvailability: 3 },
  "today-v6/sales": { fetchMembers: 1, fetchTenant: 1, getAgentsStatus: 1, getMyProfile: 1, getProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 4, listOutboxMessages: 1, listVisits: 1, readAvailability: 3 },
  "today-v6/viewer": { fetchMembers: 1, fetchTenant: 1, getAgentsStatus: 1, getMyProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 2, readAvailability: 1 },
  "today-v6-day-one/owner": { fetchMembers: 1, fetchQuotes: 2, fetchTenant: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getExampleStatus: 1, getMyProfile: 1, getOutboxSettings: 1, getProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 4, listCallRequests: 1, listCatalogueItems: 1, listOutboxApprovals: 1, listOutboxMessages: 1, listVisits: 2, readAvailability: 3 },
  "today-v6-education/owner": { fetchMembers: 1, fetchQuotes: 2, fetchTenant: 1, getAccountSecurity: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getExampleStatus: 1, getInstitutionProfile: 1, getMyProfile: 1, getOutboxSettings: 1, getProfile: 2, getSlots: 1, getToday: 1, getTodayVisits: 1, getWhatsappAccount: 1, getWorkspacePack: 4, listAdmissions: 1, listCallRequests: 1, listCampaigns: 2, listFeePlans: 1, listOutboxApprovals: 1, listOutboxMessages: 1, listStudents: 1, listVisits: 3, readAvailability: 3, runReport: 1 },
  "today-v6-example-loaded/owner": { fetchMembers: 1, fetchQuotes: 2, fetchTenant: 1, getAccountSecurity: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getExampleStatus: 1, getLedgerSummary: 1, getMaterialPolicy: 1, getMyProfile: 1, getOutboxSettings: 1, getProfile: 2, getSlots: 1, getToday: 1, getTodayVisits: 1, getWhatsappAccount: 1, getWorkspacePack: 4, listCallRequests: 1, listMaterialItems: 1, listMaterialQuotes: 2, listOutboxApprovals: 1, listOutboxMessages: 1, listTrips: 1, listVisits: 2, readAvailability: 3 },
  "today/owner": { fetchMembers: 2, fetchQuotes: 1, fetchTenant: 1, getAgentsStatus: 1, getAiUsageWeek: 1, getMyProfile: 1, getOutboxSettings: 2, getSlots: 1, getToday: 1, getTodayVisits: 1, getVisitSettings: 1, getWorkspacePack: 4, listCallRequests: 1, listCatalogueItems: 1, listOutboxApprovals: 1, listOutboxMessages: 1, listVisits: 1, readAvailability: 3 },
  "today/viewer": { fetchMembers: 1, fetchTenant: 1, getAgentsStatus: 1, getMyProfile: 1, getSlots: 1, getToday: 1, getTodayVisits: 1, getWorkspacePack: 2, readAvailability: 1 },
  };
  it.each(Object.keys(BEFORE))("%s: no read more often than before, and none new", async (key) => {
    const [id, role] = key.split("/") as [string, (typeof ROLES)[number]];
    await capture(SCENARIOS.find((s) => s.id === id)!, role);
    const now: Record<string, number> = {};
    for (const name of callLog) now[name] = (now[name] ?? 0) + 1;
    for (const [name, n] of Object.entries(now)) expect(n, `${key}: ${name}`).toBeLessThanOrEqual(BEFORE[key][name] ?? 0);
  });
});
