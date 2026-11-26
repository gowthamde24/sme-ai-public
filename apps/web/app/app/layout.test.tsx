import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock, redirectTarget } from "@/test/helpers";

const here = vi.hoisted(() => ({ path: "/app" }));
const requireUser = vi.fn();
const fetchMe = vi.fn();
const jar = new Map<string, string>();
const hdr = new Map<string, string>();
const getMyProfile = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }), headers: async () => ({ get: (n: string) => hdr.get(n) ?? null }) }));
vi.mock("@/lib/api/me", () => ({ getMyProfile: (...a: unknown[]) => getMyProfile(...a) }));
const readPack = vi.hoisted(() => vi.fn(async (..._a: unknown[]): Promise<unknown> => null));
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));
vi.mock("next/navigation", () => ({ usePathname: () => here.path, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }), redirect: (to: string) => redirectMock(to) }));
vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchMe: (...a: unknown[]) => fetchMe(...a) }));
vi.mock("./actions", () => ({ signOut: vi.fn(async () => undefined), createTenantAction: vi.fn() }));

import AppLayout, { metadata } from "./layout";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "o@example.test", accessToken: "tok", aal: "aal2" };
const T = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
  hdr.clear();
  here.path = "/app";
  readPack.mockReset().mockResolvedValue(null);
  getMyProfile.mockReset().mockResolvedValue({ displayName: null, language: null, picture: "none", pictureUrl: null });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  requireUser.mockResolvedValue(USER);
  fetchMe.mockResolvedValue({ user_id: USER.id, memberships: [{ role: "owner", tenant: { id: T, name: "Acme", slug: "acme" } }] });
});

const page = <main>The page</main>;

describe("the /app layout (the workspace frame)", () => {
  it("sends a person with no session to sign in before reading anything else, as the pages do", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    expect(await redirectTarget(() => AppLayout({ children: page }))).toBe("/login");
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it("asks the API who the person is with their own token and draws the page inside the frame", async () => {
    render(await AppLayout({ children: page }));
    expect(fetchMe).toHaveBeenCalledWith("tok");
    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0); // the phone's account menu and the side menu's footer
  });

  it("app v4: the first paint is already the v4 frame (the phone bar is the five groups), so nothing is re-drawn and jumps when the workspace's layout hands the data over", async () => {
    vi.stubEnv("APP_V4", "1");
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    here.path = `/app/tenants/${T}`;
    render(await AppLayout({ children: page }));
    expect(screen.getAllByText("Customers").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    vi.unstubAllEnvs();
  });

  it("with APP_V4 off the first paint is the frame it always was (the phone bar still has More)", async () => {
    vi.stubEnv("APP_V4", "");
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    here.path = `/app/tenants/${T}`;
    render(await AppLayout({ children: page }));
    expect(screen.getAllByRole("button", { name: "More" }).length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });

  it("draws the account part only, and still the page, when the API cannot be read or answers for someone else", async () => {
    fetchMe.mockRejectedValue(new Error("down"));
    render(await AppLayout({ children: page }));
    expect(screen.getByText("The page")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your workspaces" })).toBeNull();
    cleanup();
    fetchMe.mockResolvedValue({ user_id: "99999999-9999-4999-8999-999999999999", memberships: [{ role: "owner", tenant: { id: T, name: "Acme", slug: "acme" } }] });
    render(await AppLayout({ children: page }));
    expect(screen.getByText("The page")).toBeInTheDocument();
  });

  it("inside a workspace the menu footer has the person's picture over their letters (drawn by the server); outside one, none", async () => {
    hdr.set("x-sme-path", `/app/tenants/${T}/settings`);
    getMyProfile.mockResolvedValue({ displayName: "Ravi Kumar", language: "te", picture: "own", pictureUrl: "https://img.example/me.jpg" });
    const { container, unmount } = render(await AppLayout({ children: page }));
    expect(getMyProfile).toHaveBeenCalledWith("tok", T);
    expect(container.querySelector('[style*="https://img.example/me.jpg"]')).not.toBeNull(); // the picture is a background (a dead link then draws nothing)
    expect(screen.getAllByText("RK").length).toBeGreaterThan(0);
    unmount();
    hdr.clear();
    getMyProfile.mockClear();
    const outside = render(await AppLayout({ children: page }));
    expect(getMyProfile).not.toHaveBeenCalled();
    expect(outside.container.querySelector("img")).toBeNull();
  });

  it("asks the pack and the person's profile at the same moment as /v1/me, not after it (one round trip less before the first byte)", async () => {
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    let answer: (v: unknown) => void = () => undefined;
    fetchMe.mockReturnValue(new Promise((r) => (answer = r)));
    const drawn = AppLayout({ children: page });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMe).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith("tok", T); // asked while /v1/me is still on its way
    expect(getMyProfile).toHaveBeenCalledWith("tok", T);
    answer({ user_id: USER.id, memberships: [{ role: "owner", tenant: { id: T, name: "Acme", slug: "acme" } }] });
    getMyProfile.mockClear();
    const { container } = render(await drawn);
    expect(getMyProfile).not.toHaveBeenCalled(); // (asked once only)
    expect(container.querySelector("aside img")).toBeNull();
    expect(screen.getByText("The page")).toBeInTheDocument();
  });

  it("draws nothing of a workspace the person is not a member of, though its reads were started early (the API refuses them)", async () => {
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    fetchMe.mockResolvedValue({ user_id: USER.id, memberships: [{ role: "owner", tenant: { id: "33333333-3333-4333-8333-333333333333", name: "Other", slug: "other" } }] });
    getMyProfile.mockResolvedValue({ displayName: "Ravi Kumar", language: "te", picture: "own", pictureUrl: "https://img.example/me.jpg" });
    const { container } = render(await AppLayout({ children: page }));
    expect(container.querySelector('img[src="https://img.example/me.jpg"]')).toBeNull();
    expect(screen.getByText("The page")).toBeInTheDocument();
  });

  it("a pack read that fails, or is refused, while /v1/me is still on its way is not an unhandled rejection and draws the plain menu", async () => {
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    readPack.mockRejectedValue(new Error("refused"));
    render(await AppLayout({ children: page }));
    expect(screen.getByText("The page")).toBeInTheDocument();
  });

  it("a profile that cannot be read leaves the letters of the e-mail address", async () => {
    hdr.set("x-sme-path", `/app/tenants/${T}`);
    getMyProfile.mockRejectedValue(new Error("down"));
    const { container } = render(await AppLayout({ children: page }));
    expect(container.querySelector("aside img")).toBeNull();
    expect(screen.getAllByText("O").length).toBeGreaterThan(0); // the letters of o@example.test
  });

  it("follows the saved theme, and the frame is never indexed", async () => {
    jar.set("sme_theme", "dark");
    const { container } = render(await AppLayout({ children: page }));
    expect(container.querySelector('[data-ui="v2"]')?.getAttribute("data-theme")).toBe("dark");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

import { cleanup } from "@testing-library/react";
