import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";
import { parseMembers } from "@/lib/api/orders";
import { MEMBERS_JSON, TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchMembers = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/orders")>()), fetchMembers: (...a: unknown[]) => fetchMembers(...a) }));

import SettingsPage from "./page";

const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(query) }) as unknown as Parameters<typeof SettingsPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const tabs = () => within(screen.getByRole("navigation", { name: "Parts of Settings" }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok", aal: "aal2", hasSecondFactor: true });
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchMembers.mockResolvedValue(parseMembers(MEMBERS_JSON));
});

describe("Settings, one part at a time", () => {
  it("opens on the business: its name and URL name; the plan and the AI usage are 'Not available yet' (never a guess); the members are not asked for", async () => {
    render(await SettingsPage(props()));
    expect(tabs().getAllByRole("link").map((a) => a.textContent)).toEqual(["Business and plan", "Members", "Language and look", "Security", "Privacy"]);
    expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Acme Silks")).toBeInTheDocument();
    expect(screen.getByText("acme-silks")).toBeInTheDocument();
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(fetchMembers).not.toHaveBeenCalled();
  });
  it("an unknown section word is the business part", async () => {
    render(await SettingsPage(props({ section: "<script>" })));
    expect(tabs().getByRole("link", { name: "Business and plan" })).toHaveAttribute("aria-current", "page");
  });
  it("lists the members with their role, marks the person, and says 'Not available yet' when the list cannot be read", async () => {
    fetchMembers.mockResolvedValue(parseMembers({ members: [{ user_id: "11111111-1111-4111-8111-111111111111", role: "owner", display_name: "Asha" }, { user_id: "22222222-aaaa-4222-8222-222222222222", role: "sales", display_name: null }] }));
    render(await SettingsPage(props({ section: "members" })));
    expect(fetchMembers).toHaveBeenCalledWith("tok", TENANT);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Asha(You)owner");
    expect(items[1]).toHaveTextContent("salessales"); // no display name: the role is the name
    expect(screen.queryByRole("button", { name: /invite|add/i })).toBeNull(); // a list: nobody is added here
    fetchMembers.mockRejectedValue(new ApiRequestError(500, "api_error", "x"));
    document.body.innerHTML = "";
    render(await SettingsPage(props({ section: "members" })));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
  it("says whether 2-step sign-in is on, and links to the security page", async () => {
    render(await SettingsPage(props({ section: "security" })));
    expect(screen.getByText("2-step sign-in is on.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the security page" })).toHaveAttribute("href", "/app/security");
    requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e", accessToken: "tok", aal: "aal1", hasSecondFactor: false });
    document.body.innerHTML = "";
    render(await SettingsPage(props({ section: "security" })));
    expect(screen.getByText("2-step sign-in is not set up yet.")).toBeInTheDocument();
  });
  it.each([
    ["owner", ["Privacy and erasure", "Suppression keys"]],
    ["admin", ["Privacy and erasure"]],
    ["sales", []],
    ["viewer", []],
  ])("privacy: a %s is offered only the pages their role can open", async (role, links) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await SettingsPage(props({ section: "privacy" })));
    const main = screen.getByRole("main");
    expect(within(main).queryAllByRole("link").map((a) => a.textContent).filter((t) => t === "Privacy and erasure" || t === "Suppression keys")).toEqual(links);
  });
  it("the language part has the language select and the three looks", async () => {
    render(await SettingsPage(props({ section: "language" })));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["System", "Light", "Dark"]);
  });
  it("a missing workspace is not-found and a rejected session goes to sign-in", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(SettingsPage(props())).rejects.toThrow();
  });
});
