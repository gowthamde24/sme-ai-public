import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const listTemplates = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/whatsapp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/whatsapp")>()), listTemplates: (...a: unknown[]) => listTemplates(...a) }));
vi.mock("./actions", () => ({ submitDraftsAction: vi.fn(), submitTemplateAction: vi.fn(), syncTemplatesAction: vi.fn() }));
const apiRequest = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import TemplatesPage from "./page";

const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof TemplatesPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme", role });
const TPL = { id: "77777777-7777-4777-8777-777777777771", name: "lead_ack", language: "en", purpose: "followup", status: "draft" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  listTemplates.mockResolvedValue([TPL]);
});

describe("/chats/templates: Your own messages (JOBS)", () => {
  it("JOBS=mock: the own messages are there (nothing is asked of the API for them)", async () => {
    vi.stubEnv("JOBS", "mock");
    render(await TemplatesPage(props()));
    expect(await screen.findByText("Your own messages")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("JOBS on: ONLY a 404 of the own-messages route is quiet (the part is not drawn); a refusal is said in that part's place and the table stays", async () => {
    vi.stubEnv("JOBS", "1");
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    render(await TemplatesPage(props()));
    expect(document.querySelector('[data-problem]')).toBeNull();
    expect(screen.queryByText("Your own messages")).toBeNull();
    expect(screen.getByText("lead_ack")).toBeInTheDocument();
    cleanup();
    apiRequest.mockRejectedValueOnce(new ApiRequestError(503, "down", "x"));
    render(await TemplatesPage(props()));
    expect(document.querySelector('[data-problem="500"]')).toBeTruthy();
    expect(screen.getByText("Your own messages")).toBeInTheDocument();
    expect(screen.getByText("lead_ack")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});

describe("/chats/templates (the third tab of Chats)", () => {
  it("the Owner and Admin get the title, the table and the two buttons", async () => {
    render(await TemplatesPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Templates" })).toBeInTheDocument();
    expect(screen.getByText("lead_ack")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send drafts to WhatsApp for review" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check WhatsApp's answer" })).toBeInTheDocument();
    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await TemplatesPage(props()));
    expect(screen.getAllByRole("button", { name: "Check WhatsApp's answer" }).length).toBe(2);
  });
  it.each(["sales", "viewer"])("a %s is told it is for owners and admins and nothing is read", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await TemplatesPage(props()));
    expect(screen.getByText("Integrations are shown to owners and admins.")).toBeInTheDocument();
    expect(listTemplates).not.toHaveBeenCalled();
  });
  it("a list that is refused says so in its place; a rejected session signs in; an unknown workspace is not found", async () => {
    listTemplates.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    render(await TemplatesPage(props()));
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    listTemplates.mockRejectedValue(new ApiAuthError("x"));
    await expect(TemplatesPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(TemplatesPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
