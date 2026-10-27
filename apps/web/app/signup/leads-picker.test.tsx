import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
const cardIds = () => Array.from(document.querySelectorAll("[data-pack-card]")).map((e) => e.getAttribute("data-pack-card"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  packList.mockResolvedValue([...DEEP, ...MOCK_TEMPLATES.map(toPackSummary)]);
  templates.mockResolvedValue([...MOCK_TEMPLATES]);
});
afterEach(cleanup);

describe("sign-up step 1 with Lead Desk (night 4, part A1)", () => {
  it("with the flag off nothing changes: every business type the API lists is a card, and no 'any business with leads'", async () => {
    render(await SignupPage(props()));
    expect(cardIds()).toEqual([...DEEP, ...MOCK_TEMPLATES].map((p) => ("packId" in p ? p.packId : "")));
    expect(screen.queryByText("Any business with leads")).toBeNull();
    expect(templates).not.toHaveBeenCalled();
  });
  it("with the flag on the nine become ONE card after the others, which opens the picker", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    render(await SignupPage(props()));
    const ids = cardIds();
    expect(ids).toHaveLength(DEEP.length + 1);
    expect(ids[ids.length - 1]).toBe("leads");
    for (const t of MOCK_TEMPLATES) expect(ids).not.toContain(t.packId);
    const card = document.querySelector('[data-pack-card="leads"]') as HTMLAnchorElement;
    expect(card).toHaveAttribute("href", "/signup?type=leads");
    expect(within(card).getByText("Any business with leads")).toBeInTheDocument();
  });
  it("the picker lists the nine, each leading to step 2 with its own business type, and a way back", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    render(await SignupPage(props({ type: "leads" })));
    const list = document.querySelector("[data-part=lead-templates]") as HTMLElement;
    expect(within(list).getAllByRole("link")).toHaveLength(9);
    expect(list.querySelector('[data-pack-card="real_estate"]')).toHaveAttribute("href", "/signup?type=real_estate");
    expect(screen.getAllByText("Not validated by a real owner yet", { exact: false })).toHaveLength(9);
    expect(screen.getByRole("link", { name: "Back to all business types" })).toHaveAttribute("href", "/signup");
  });
  it("one of the nine chosen goes to step 2 (the sign-in choices) as an ordinary business type", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    render(await SignupPage(props({ type: "clinic" })));
    expect(document.querySelector("[data-chosen-pack=clinic]")).not.toBeNull();
    expect(screen.getAllByText(/clinic/i).length).toBeGreaterThan(0);
  });
  it("if the templates cannot be read the sign-up shows the business types as the API lists them, never a card that leads nowhere", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    templates.mockRejectedValueOnce(new Error("down"));
    render(await SignupPage(props()));
    expect(cardIds()).toHaveLength(DEEP.length + MOCK_TEMPLATES.length);
    expect(screen.queryByText("Any business with leads")).toBeNull();
  });
  it("in the test screens the made-up nine work even when the real API does not list them", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    packList.mockResolvedValue(DEEP);
    render(await SignupPage(props({ type: "gym" })));
    expect(document.querySelector("[data-chosen-pack=gym]")).not.toBeNull();
  });
});
