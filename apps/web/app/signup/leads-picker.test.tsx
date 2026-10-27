import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({ signUp: vi.fn() }));
vi.mock("./oauth-actions", () => ({ continueWithProvider: vi.fn() }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("@/lib/api/policy", async (orig) => ({ ...(await orig<typeof import("@/lib/api/policy")>()), getCurrentPolicies: async () => ({ terms: "2026-10-27", privacy: "2026-10-27" }) }));
const packList = vi.fn();
const templates = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), listPacks: () => packList(), getAuthProviders: async () => ({ google: true, facebook: true }) }));
vi.mock("@/lib/api/lead-templates", () => ({ listLeadTemplates: () => templates() }));

import { parsePackSummary } from "@/lib/api/pack";
import { MOCK_TEMPLATES, toPackSummary } from "@/lib/lead-desk/templates";
import { packsWire } from "@/lib/packs/pack-test-kit";

import SignupPage from "./page";

const props = (query: Record<string, string | undefined> = {}) => ({ searchParams: Promise.resolve(query), params: Promise.resolve({}) }) as never;
const DEEP = packsWire().packs.map(parsePackSummary).filter((p) => !MOCK_TEMPLATES.some((t) => t.packId === p.packId)); // the API now lists the nine too: the deep ones are the rest

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  packList.mockResolvedValue([...DEEP, ...MOCK_TEMPLATES.map(toPackSummary)]);
  templates.mockResolvedValue([...MOCK_TEMPLATES]);
});
afterEach(cleanup);

const optionIds = () => {
  fireEvent.focus(screen.getByRole("combobox"));
  return within(screen.getByRole("listbox")).getAllByRole("option").map((e) => e.getAttribute("data-pack-card"));
};
const groupLabels = () => within(screen.getByRole("listbox")).getAllByRole("group").map((g) => g.querySelector("p")?.textContent);

describe("sign-up step 1: one list, grouped (Built especially for / Lead Desk / Other)", () => {
  it("with the Lead Desk flag off the types are one plain group, and the templates are not asked", async () => {
    render(await SignupPage(props()));
    expect(optionIds()).toEqual([...DEEP, ...MOCK_TEMPLATES].map((p) => ("packId" in p ? p.packId : "")));
    expect(groupLabels()).toEqual(["Business types"]);
    expect(templates).not.toHaveBeenCalled();
  });
  it("with the flag on the types with their own pages and the nine of Lead Desk are two groups, in that order", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    render(await SignupPage(props()));
    const ids = optionIds();
    expect(ids).toEqual([...DEEP.map((p) => p.packId), ...MOCK_TEMPLATES.map((t) => t.packId)]);
    expect(groupLabels()).toEqual(["Built especially for", "Lead Desk"]);
  });
  it("a business type the API lists as 'Other' is the last group, and choosing it goes on to step 2 like any other", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    packList.mockResolvedValue([...DEEP, ...MOCK_TEMPLATES.map(toPackSummary), { ...toPackSummary(MOCK_TEMPLATES[0]), packId: "other", names: { en: "Other business" }, summary: { en: "x" } }]);
    render(await SignupPage(props()));
    expect(optionIds().at(-1)).toBe("other");
    expect(groupLabels().at(-1)).toBe("Other");
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Other/ }));
    expect(push).toHaveBeenCalledWith("/signup?type=other");
  });
  it("one of the nine chosen goes to step 2 (the sign-in choices) as an ordinary business type", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    render(await SignupPage(props({ type: "clinic" })));
    expect(document.querySelector("[data-chosen-pack=clinic]")).not.toBeNull();
    expect(screen.getAllByText(/clinic/i).length).toBeGreaterThan(0);
  });
  it("if the templates cannot be read the sign-up shows the business types as the API lists them, in one group", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    templates.mockRejectedValueOnce(new Error("down"));
    render(await SignupPage(props()));
    expect(optionIds()).toHaveLength(DEEP.length + MOCK_TEMPLATES.length);
    expect(groupLabels()).toEqual(["Business types"]);
  });
  it("in the test screens the made-up nine work even when the real API does not list them", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    packList.mockResolvedValue(DEEP);
    render(await SignupPage(props({ type: "gym" })));
    expect(document.querySelector("[data-chosen-pack=gym]")).not.toBeNull();
  });
});
