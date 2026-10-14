import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const reads = { getProfile: vi.fn(), listCatalogueItems: vi.fn(), fetchQuotePolicyVersions: vi.fn(), getWhatsappAccount: vi.fn(), fetchQuotes: vi.fn() };
vi.mock("@/lib/api/profile", () => ({ getProfile: (...a: unknown[]) => reads.getProfile(...a) }));
vi.mock("@/lib/api/catalogue", () => ({ listCatalogueItems: (...a: unknown[]) => reads.listCatalogueItems(...a) }));
vi.mock("@/lib/api/quote-policies", () => ({ fetchQuotePolicyVersions: (...a: unknown[]) => reads.fetchQuotePolicyVersions(...a) }));
vi.mock("@/lib/api/whatsapp", () => ({ getWhatsappAccount: (...a: unknown[]) => reads.getWhatsappAccount(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuotes: (...a: unknown[]) => reads.fetchQuotes(...a) }));

import { readActivation } from "./activation";
import { readFacts } from "./activation-facts";
import { PACKS } from "./registry";

const T = "22222222-2222-2222-2222-222222222222";
const construction = PACKS.find((p) => p.id.startsWith("con"))!;
const education = PACKS.find((p) => p.id.startsWith("edu"))!;

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

describe("the activation checklist of a business type", () => {
  it("lists the pack's steps in order, in the person's language, each done, to do, or not available yet", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    const a = await readActivation("tok", T, construction, "en");
    expect(a.steps.map((s) => [s.id, s.state])).toEqual([["profile", "done"], ["products", "todo"], ["delivery", "unavailable"], ["whatsapp", "todo"], ["first_quote", "todo"]]);
    expect(a.done).toBe(1);
    expect(a.total).toBe(5);
    expect(a.next?.id).toBe("products");
    expect(a.steps[1].href).toBe("/catalogue/new");
    expect(a.steps[2].href).toBeNull(); // no screen yet
    expect((await readActivation("tok", T, construction, "hi")).steps[0].title).toBe("अपने व्यापार का नाम और शहर बताइए");
  });
  it("never counts a step whose screen is not built as done, and the education list has three of them", async () => {
    const a = await readActivation("tok", T, education, "en");
    expect(a.steps.filter((s) => s.state === "unavailable").map((s) => s.id)).toEqual(["students", "fee_plan", "first_campaign"]);
    expect(a.next?.id).toBe("profile");
    expect(a.done).toBe(0);
  });
  it("has no next step when only unavailable ones are left", async () => {
    reads.getProfile.mockResolvedValue({ name: "x", town: "Guntur", setupComplete: true });
    reads.getWhatsappAccount.mockResolvedValue({ configured: true, status: "active" });
    const a = await readActivation("tok", T, education, "en");
    expect(a.next).toBeNull();
    expect(a.done).toBe(2);
  });
});
