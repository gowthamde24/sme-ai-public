import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchMe = vi.fn();
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined) }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }), redirect: (to: string) => redirectMock(to) }));
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
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
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

  it("follows the saved theme, and the frame is never indexed", async () => {
    jar.set("sme_theme", "dark");
    const { container } = render(await AppLayout({ children: page }));
    expect(container.querySelector('[data-ui="v2"]')?.getAttribute("data-theme")).toBe("dark");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

import { cleanup } from "@testing-library/react";
