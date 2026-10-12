import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const listConversations = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/whatsapp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/whatsapp")>()), listConversations: (...a: unknown[]) => listConversations(...a) }));

import ChatsPage from "./page";

const props = (q: Record<string, string> = {}) => ({ params: Promise.resolve({ tenantId: TENANT }), searchParams: Promise.resolve(q) }) as unknown as Parameters<typeof ChatsPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme", role });
const CONV = { lead_id: "33333333-3333-4333-8333-333333333333", name: "Ravi", company: null, last_at: "2026-10-12T08:00:00Z", last_direction: "in", preview: "Hello", window_open: true, window_expires_at: null, unread: false, stopped: false };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  listConversations.mockResolvedValue({ conversations: [CONV], next_before: "2026-10-12T07:00:00Z" });
});

describe("/chats", () => {
  it("lists the chats and links to older ones with the API's cursor", async () => {
    render(await ChatsPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Customer chats" })).toBeInTheDocument();
    expect(screen.getByText("Ravi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Older chats" })).toHaveAttribute("href", `/app/tenants/${TENANT}/chats?before=2026-10-12T07%3A00%3A00Z`);
    expect(listConversations).toHaveBeenCalledWith("tok", TENANT, { limit: 30, before: null });
  });
  it("passes a good ?before= on and drops a bad one", async () => {
    await ChatsPage(props({ before: "2026-10-12T07:00:00Z" }));
    expect(listConversations).toHaveBeenLastCalledWith("tok", TENANT, { limit: 30, before: "2026-10-12T07:00:00Z" });
    await ChatsPage(props({ before: "../../x" }));
    expect(listConversations).toHaveBeenLastCalledWith("tok", TENANT, { limit: 30, before: null });
  });
  it("a viewer is told this is not theirs and nothing is read", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await ChatsPage(props()));
    expect(screen.getByText(/Customer chats are for the owner, admins and sales/)).toBeInTheDocument();
    expect(listConversations).not.toHaveBeenCalled();
  });
  it.each([[new ApiRequestError(403, "forbidden", "x"), /does not include this page/], [new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 30), /Wait 30 seconds/], [new ApiRequestError(503, "api_unreachable", "x"), /could not be loaded/]])("a read that fails (%j) says so in words", async (error, words) => {
    listConversations.mockRejectedValue(error);
    render(await ChatsPage(props()));
    expect(screen.getByText(words)).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in; an unknown workspace is not found", async () => {
    listConversations.mockRejectedValue(new ApiAuthError("x"));
    await expect(ChatsPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ChatsPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("a refused or rate-limited read goes to the friendly pages (job CC, screen 7)", () => {
  it.each([[403, "/app/problem/403"], [429, "/app/problem/429"]])("the workspace read answering %i goes to %s", async (status, to) => {
    fetchTenant.mockRejectedValue(new ApiRequestError(status, status === 429 ? "rate_limited" : "forbidden", "x"));
    await expect(ChatsPage(props())).rejects.toThrow(`NEXT_REDIRECT:${to}`);
  });
  it("an unreachable service still says so on the page", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await ChatsPage(props()));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
