import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const reads = { getProfile: vi.fn(), listCatalogueItems: vi.fn(), fetchQuotePolicyVersions: vi.fn(), getWhatsappAccount: vi.fn(), fetchQuotes: vi.fn() };
vi.mock("@/lib/api/profile", () => ({ getProfile: (...a: unknown[]) => reads.getProfile(...a) }));
vi.mock("@/lib/api/catalogue", () => ({ listCatalogueItems: (...a: unknown[]) => reads.listCatalogueItems(...a) }));
vi.mock("@/lib/api/quote-policies", () => ({ fetchQuotePolicyVersions: (...a: unknown[]) => reads.fetchQuotePolicyVersions(...a) }));
vi.mock("@/lib/api/whatsapp", () => ({ getWhatsappAccount: (...a: unknown[]) => reads.getWhatsappAccount(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuotes: (...a: unknown[]) => reads.fetchQuotes(...a) }));

import { appT } from "@/i18n/app";

import { readActivation, stepChecks, usesChecklist } from "./activation";
import { readFacts } from "./activation-facts";
import { defaultPackId, otherPackIds, workspacePack } from "./pack-test-kit";

const T = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  reads.getProfile.mockResolvedValue({ name: "x", town: null, setupComplete: false });
  reads.listCatalogueItems.mockResolvedValue({ items: [] });
  reads.fetchQuotePolicyVersions.mockResolvedValue([]);
  reads.getWhatsappAccount.mockResolvedValue({ configured: false });
  reads.fetchQuotes.mockResolvedValue([]);
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
  it("a business with a catalogue, quotes and an inbox: name and city, products, quote rules, WhatsApp, the first quote", () => {
    expect(stepChecks(modulesOf(textiles))).toEqual(["business_profile", "catalogue_has_items", "quote_rules_set", "whatsapp_connected", "first_quote_sent"]);
  });
  it("one that also delivers: the delivery rule takes the place of the quote rules", () => {
    expect(stepChecks(modulesOf(construction))).toEqual(["business_profile", "catalogue_has_items", "delivery_rule_set", "whatsapp_connected", "first_quote_sent"]);
  });
  it("one with programmes and fees and no quotes: people, the fee plan, WhatsApp, the first reminder campaign", () => {
    expect(stepChecks(modulesOf(education))).toEqual(["business_profile", "students_imported", "fee_plan_set", "whatsapp_connected", "first_campaign_approved"]);
  });
  it("a bare workspace has the one step every business has", () => {
    expect(stepChecks(["today"])).toEqual(["business_profile"]);
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
    expect(a.steps.map((s) => [s.id, s.state])).toEqual([["business_profile", "done"], ["catalogue_has_items", "todo"], ["delivery_rule_set", "unavailable"], ["whatsapp_connected", "todo"], ["first_quote_sent", "todo"]]);
    expect(a.done).toBe(1);
    expect(a.total).toBe(5);
    expect(a.next?.id).toBe("catalogue_has_items");
    expect(a.steps[1].href).toBe("/catalogue/new");
    expect(a.steps[2].href).toBeNull(); // no screen yet
    expect(a.steps[0].title).toBe("Tell us your business name and city");
  });
  it("speaks the person's language", async () => {
    const hi = appT("hi");
    const a = await readActivation("tok", T, workspacePack(defaultPackId()), hi);
    expect(a.steps[0].title).toBe("अपने व्यापार का नाम और शहर बताइए");
  });
  it("never counts a step whose screen is not built as done, and a school has three of them", async () => {
    const education = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!);
    const a = await readActivation("tok", T, education, t);
    expect(a.steps.filter((s) => s.state === "unavailable").map((s) => s.id)).toEqual(["students_imported", "fee_plan_set", "first_campaign_approved"]);
    expect(a.next?.id).toBe("business_profile");
    expect(a.done).toBe(0);
  });
  it("has no next step when only unavailable ones are left", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    reads.getWhatsappAccount.mockResolvedValue({ configured: true, status: "active" });
    const education = workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!);
    const a = await readActivation("tok", T, education, t);
    expect(a.next).toBeNull();
    expect(a.done).toBe(2);
  });
});
