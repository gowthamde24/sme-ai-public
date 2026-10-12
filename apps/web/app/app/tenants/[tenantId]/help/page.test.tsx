import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const lang = { value: "en" };
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => lang.value }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));

import HelpPage from "./page";
import HelpGuidePage from "./[guide]/page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const index = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof HelpPage>[0];
const guide = (g: string, tenantId = TENANT) => ({ params: Promise.resolve({ tenantId, guide: g }) }) as unknown as Parameters<typeof HelpGuidePage>[0];

beforeEach(() => {
  vi.clearAllMocks();
  lang.value = "en";
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: TENANT, name: "Acme Silks", slug: "acme", role: "viewer" });
});

describe("/help (job BT)", () => {
  it("authenticates first and lists the guides for any member, a viewer too", async () => {
    render(await HelpPage(index()));
    expect(requireUser).toHaveBeenCalled();
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
    expect(screen.getByRole("main")).toHaveAttribute("lang", "en");
    expect(screen.getAllByRole("link")).toHaveLength(8);
  });
  it("speaks the language of the cookie", async () => {
    lang.value = "hi";
    render(await HelpPage(index()));
    expect(screen.getByRole("main")).toHaveAttribute("lang", "hi");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("मदद");
  });
  it("a workspace that does not exist is the same not-found page; a refused session goes to sign-in; an API that is down says so", async () => {
    fetchTenant.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    await expect(HelpPage(index())).rejects.toThrow();
    fetchTenant.mockRejectedValueOnce(new ApiAuthError());
    await expect(HelpPage(index())).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/login");
    fetchTenant.mockRejectedValueOnce(new ApiRequestError(503, "x", "x"));
    render(await HelpPage(index()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("/help/[guide] (job BT)", () => {
  it("shows one guide", async () => {
    render(await HelpGuidePage(guide("today")));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Today: what needs you");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
  it("an unknown guide, a malformed workspace id and a path trick are all not-found, before any call", async () => {
    for (const g of ["nope", "../etc", "TODAY", ""]) await expect(HelpGuidePage(guide(g))).rejects.toThrow();
    await expect(HelpGuidePage(guide("today", "not-a-uuid"))).rejects.toThrow();
    expect(fetchTenant).not.toHaveBeenCalled();
  });
  it("English-only guides carry the note in another language", async () => {
    lang.value = "te";
    render(await HelpGuidePage(guide("privacy")));
    expect(screen.getByRole("note")).toHaveTextContent("ఇంగ్లీష్‌లోనే");
  });
});
