import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const reads = { listSources: vi.fn(), listLeadImports: vi.fn(), listRules: vi.fn(), listTasks: vi.fn(), getProfile: vi.fn(), listCatalogueItems: vi.fn(), fetchQuotePolicyVersions: vi.fn(), getWhatsappAccount: vi.fn(), fetchQuotes: vi.fn(), getAccountSecurity: vi.fn(), getInstitutionProfile: vi.fn(), listStudents: vi.fn(), listFeePlans: vi.fn(), listCampaigns: vi.fn(), getMaterialPolicy: vi.fn() };
vi.mock("@/lib/api/lead-sources", () => ({ listSources: (...a: unknown[]) => reads.listSources(...a) }));
vi.mock("@/lib/api/lead-imports", () => ({ listLeadImports: (...a: unknown[]) => reads.listLeadImports(...a) }));
vi.mock("@/lib/api/outreach", () => ({ listRules: (...a: unknown[]) => reads.listRules(...a) }));
vi.mock("@/lib/api/tasks", () => ({ listTasks: (...a: unknown[]) => reads.listTasks(...a) }));
vi.mock("@/lib/api/profile", () => ({ getProfile: (...a: unknown[]) => reads.getProfile(...a) }));
vi.mock("@/lib/api/catalogue", () => ({ listCatalogueItems: (...a: unknown[]) => reads.listCatalogueItems(...a) }));
vi.mock("@/lib/api/quote-policies", () => ({ fetchQuotePolicyVersions: (...a: unknown[]) => reads.fetchQuotePolicyVersions(...a) }));
vi.mock("@/lib/api/whatsapp", () => ({ getWhatsappAccount: (...a: unknown[]) => reads.getWhatsappAccount(...a) }));
vi.mock("@/lib/api/education", () => ({ getInstitutionProfile: (...a: unknown[]) => reads.getInstitutionProfile(...a), listStudents: (...a: unknown[]) => reads.listStudents(...a), listFeePlans: (...a: unknown[]) => reads.listFeePlans(...a) }));
vi.mock("@/lib/api/campaigns", () => ({ listCampaigns: (...a: unknown[]) => reads.listCampaigns(...a) }));
vi.mock("@/lib/api/materials", () => ({ getMaterialPolicy: (...a: unknown[]) => reads.getMaterialPolicy(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuotes: (...a: unknown[]) => reads.fetchQuotes(...a) }));
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), getAccountSecurity: (...a: unknown[]) => reads.getAccountSecurity(...a) }));

import { appT } from "@/i18n/app";

import { readActivation, stepChecks, usesChecklist } from "./activation";
import { readFacts } from "./activation-facts";
import { defaultPackId, otherPackIds, selectableIds, workspacePack } from "./pack-test-kit";

const T = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  reads.getProfile.mockResolvedValue({ name: "x", town: null, setupComplete: false });
  reads.listCatalogueItems.mockResolvedValue({ items: [] });
  reads.fetchQuotePolicyVersions.mockResolvedValue([]);
  reads.getWhatsappAccount.mockResolvedValue({ configured: false });
  reads.fetchQuotes.mockResolvedValue([]);
  reads.getAccountSecurity.mockResolvedValue({ level: "aal1", neededFor: ["approvals", "whatsapp_connect"] });
  reads.getInstitutionProfile.mockResolvedValue({ configured: false });
  reads.listStudents.mockResolvedValue({ items: [], next_cursor: null });
  reads.listFeePlans.mockResolvedValue([]);
  reads.listCampaigns.mockResolvedValue({ items: [], next_cursor: null });
  reads.getMaterialPolicy.mockResolvedValue({ current: null, versions: [] });
  reads.listSources.mockResolvedValue([]);
  reads.listLeadImports.mockResolvedValue([]);
  reads.listRules.mockResolvedValue([]);
  reads.listTasks.mockResolvedValue([]);
});

describe("the activation facts", () => {
  it("are real reads: the town is set, the catalogue has an item, a policy exists, WhatsApp is active, a quote was approved", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    reads.listCatalogueItems.mockResolvedValue({ items: [{}] });
    reads.fetchQuotePolicyVersions.mockResolvedValue([{}]);
    reads.getWhatsappAccount.mockResolvedValue({ configured: true, status: "active" });
    reads.fetchQuotes.mockResolvedValue([{ outcome: "draft" }, { outcome: "approved" }]);
    expect(await readFacts("tok", T, ["business_profile", "catalogue_has_items", "quote_rules_set", "whatsapp_connected", "first_quote_sent"])).toEqual({ business_profile: true, catalogue_has_items: true, quote_rules_set: true, whatsapp_connected: true, first_quote_sent: true });
  });
  it("count the second step as done only when the session is at the second level, and a status that cannot be read as not done", async () => {
    reads.getAccountSecurity.mockResolvedValue({ level: "aal2", neededFor: [] });
    expect(await readFacts("tok", T, ["second_factor_set"])).toEqual({ second_factor_set: true });
    reads.getAccountSecurity.mockResolvedValue({ level: "aal1", neededFor: ["approvals"] });
    expect(await readFacts("tok", T, ["second_factor_set"])).toEqual({ second_factor_set: false });
    reads.getAccountSecurity.mockResolvedValue(null);
    expect(await readFacts("tok", T, ["second_factor_set"])).toEqual({ second_factor_set: false });
  });
  it("count a pending WhatsApp account, a draft-only quote list and an empty town as NOT done", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: null, setupComplete: false });
    reads.getWhatsappAccount.mockResolvedValue({ configured: true, status: "pending" });
    reads.fetchQuotes.mockResolvedValue([{ outcome: "draft" }, { outcome: "rejected" }]);
    expect(await readFacts("tok", T, ["business_profile", "whatsapp_connected", "first_quote_sent"])).toEqual({ business_profile: false, whatsapp_connected: false, first_quote_sent: false });
  });
  it("count a read that fails as not done (never as done), read only what was asked, and pass a rejected session on", async () => {
    reads.listCatalogueItems.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readFacts("tok", T, ["catalogue_has_items"])).toEqual({ catalogue_has_items: false });
    expect(reads.getProfile).not.toHaveBeenCalled();
    reads.getProfile.mockRejectedValue(new ApiAuthError("x"));
    await expect(readFacts("tok", T, ["business_profile"])).rejects.toThrow(ApiAuthError);
  });
});

describe("the first-run steps come from the modules a workspace has (blueprint 3.3), never from a business type's name", () => {
  const modulesOf = (id: string) => workspacePack(id).modules;
  const textiles = defaultPackId();
  const [construction, education] = [otherPackIds().find((i) => modulesOf(i).includes("deliveries"))!, otherPackIds().find((i) => modulesOf(i).includes("fees"))!];
  it("a business with a catalogue, quotes and an inbox: name and city, products, quote rules, the second step, WhatsApp, the first quote", () => {
    expect(stepChecks(modulesOf(textiles))).toEqual(["business_profile", "catalogue_has_items", "quote_rules_set", "second_factor_set", "whatsapp_connected", "first_quote_sent"]);
  });
  it("one that also delivers: the delivery rule takes the place of the quote rules", () => {
    expect(stepChecks(modulesOf(construction))).toEqual(["business_profile", "catalogue_has_items", "delivery_rule_set", "second_factor_set", "whatsapp_connected", "first_quote_sent"]);
  });
  it("one with programmes and fees and no quotes: people, the fee plan, the second step, WhatsApp, the first reminder campaign", () => {
    expect(stepChecks(modulesOf(education))).toEqual(["business_profile", "institution_set", "students_imported", "fee_plan_set", "second_factor_set", "whatsapp_connected", "first_campaign_approved"]);
  });
  it("a bare workspace has the one step every business has; the second step is asked only where something needs it (an inbox, quotes or campaigns)", () => {
    expect(stepChecks(["today"])).toEqual(["business_profile"]);
    expect(stepChecks(["today", "inbox"])).toEqual(["business_profile", "second_factor_set", "whatsapp_connected"]);
  });
});

describe("who gets the checklist", () => {
  it("a workspace made with a chosen business type (or moved by the operator) does; one that existed before or was made without choosing keeps its first-run wizard", () => {
    expect(usesChecklist({ source: "signup" })).toBe(true);
    expect(usesChecklist({ source: "operator" })).toBe(true);
    expect(usesChecklist({ source: "legacy" })).toBe(false);
    expect(usesChecklist({ source: "default" })).toBe(false);
    expect(usesChecklist(null)).toBe(false);
  });
});

describe("the activation checklist of a workspace", () => {
  const t = appT("en");
  it("lists the steps in order, each done, to do, or not available yet", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    const construction = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("deliveries"))!);
    const a = await readActivation("tok", T, construction, t);
    expect(a.steps.map((s) => [s.id, s.state])).toEqual([["business_profile", "done"], ["catalogue_has_items", "todo"], ["delivery_rule_set", "todo"], ["second_factor_set", "todo"], ["whatsapp_connected", "todo"], ["first_quote_sent", "todo"]]);
    expect(a.done).toBe(1);
    expect(a.total).toBe(6);
    expect(a.next?.id).toBe("catalogue_has_items");
    expect(a.steps[3].href).toBe("/app/security"); // an account page, not a page of the workspace
    expect(a.steps[1].href).toBe("/catalogue/new");
    expect(a.steps[2].href).toBe("/quote-policy");
    expect(a.steps[0].title).toBe("Tell us your business name and city");
  });
  it("speaks the person's language", async () => {
    const hi = appT("hi");
    const a = await readActivation("tok", T, workspacePack(defaultPackId()), hi);
    expect(a.steps[0].title).toBe("अपने व्यापार का नाम और शहर बताइए");
  });
  it("a school starts with nothing done: every step has a screen, and the first to do is the name and city", async () => {
    const education = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!);
    const a = await readActivation("tok", T, education, t);
    expect(a.steps.map((s) => [s.id, s.state, s.href])).toEqual([
      ["business_profile", "todo", "/start"], ["institution_set", "todo", "/programmes"], ["students_imported", "todo", "/students/import"], ["fee_plan_set", "todo", "/fees/plans"],
      ["second_factor_set", "todo", "/app/security"], ["whatsapp_connected", "todo", "/integrations/whatsapp"], ["first_campaign_approved", "todo", "/campaigns"],
    ]);
    expect(a.steps.filter((s) => s.state === "unavailable")).toEqual([]);
    expect(a.next?.id).toBe("business_profile");
    expect(a.done).toBe(0);
  });
  it("a school's steps are done by what the school has: a saved institution, a student, a fee plan, an approved campaign (a draft does not count)", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    reads.getInstitutionProfile.mockResolvedValue({ configured: true });
    reads.listStudents.mockResolvedValue({ items: [{}], next_cursor: null });
    reads.listFeePlans.mockResolvedValue([{}]);
    reads.listCampaigns.mockResolvedValue({ items: [{ status: "draft" }], next_cursor: null });
    const education = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!);
    const a = await readActivation("tok", T, education, t);
    expect(a.steps.map((s) => [s.id, s.state])).toEqual([["business_profile", "done"], ["institution_set", "done"], ["students_imported", "done"], ["fee_plan_set", "done"], ["second_factor_set", "todo"], ["whatsapp_connected", "todo"], ["first_campaign_approved", "todo"]]);
    reads.listCampaigns.mockResolvedValue({ items: [{ status: "draft" }, { status: "running" }], next_cursor: null });
    expect((await readActivation("tok", T, education, t)).steps.at(-1)?.state).toBe("done");
  });
  it("a construction business is done with its delivery rule once a policy is in force", async () => {
    const construction = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("deliveries"))!);
    reads.getMaterialPolicy.mockResolvedValue({ current: { version_id: "v" }, versions: [] });
    const a = await readActivation("tok", T, construction, t);
    expect(a.steps.find((s) => s.id === "delivery_rule_set")?.state).toBe("done");
  });
});

describe("the Lead Desk steps of a business that has leads (night 4 clean-up)", () => {
  const t = appT("en");
  const leadsPack = () => workspacePack(selectableIds().find((i) => workspacePack(i).modules.includes("campaigns") && !workspacePack(i).modules.includes("fees") && !workspacePack(i).modules.includes("quotes"))!);
  it("a business with campaigns but no fees has no fee-reminder step: it has the Lead Desk steps it is given, after the second step and WhatsApp", () => {
    const m = leadsPack().modules;
    expect(stepChecks(m)).toEqual(["business_profile", "second_factor_set", "whatsapp_connected"]);
    expect(stepChecks(m, ["lead_source_added", "call_rule_approved", "ask_assistant_tried"])).toEqual(["business_profile", "second_factor_set", "whatsapp_connected", "lead_source_added", "call_rule_approved", "ask_assistant_tried"]);
    expect(stepChecks(workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!).modules)).toContain("first_campaign_approved");
  });
  it("are done by real facts: a live source or an import, an approved rule, a first task; and read the words of the closed list", async () => {
    const steps = ["lead_source_added", "call_rule_approved", "ask_assistant_tried"] as const;
    const a = await readActivation("tok", T, leadsPack(), t, steps);
    expect(a.steps.slice(-3).map((s) => [s.id, s.state, s.href])).toEqual([["lead_source_added", "todo", "/lead-sources"], ["call_rule_approved", "todo", "/outreach"], ["ask_assistant_tried", "todo", "/tasks"]]);
    expect(a.steps.slice(-3).map((s) => s.title)).toEqual(["Connect a lead source or import your leads", "Approve your first call rule", "Try “Ask Vijaya to do it”"]); // {assistant} is filled with the default name
    reads.listLeadImports.mockResolvedValue([{}]);
    reads.listRules.mockResolvedValue([{}]);
    reads.listTasks.mockResolvedValue([{}]);
    expect((await readActivation("tok", T, leadsPack(), t, steps)).steps.slice(-3).map((s) => s.state)).toEqual(["done", "done", "done"]);
    reads.listLeadImports.mockResolvedValue([]);
    reads.listSources.mockResolvedValue([{}]);
    expect((await readFacts("tok", T, ["lead_source_added"]))).toEqual({ lead_source_added: true });
  });
});
