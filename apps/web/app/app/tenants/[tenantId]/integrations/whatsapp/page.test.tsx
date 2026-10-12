import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getWhatsappAccount = vi.fn();
const listTemplates = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/whatsapp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/whatsapp")>()), getWhatsappAccount: (...a: unknown[]) => getWhatsappAccount(...a), listTemplates: (...a: unknown[]) => listTemplates(...a) }));
vi.mock("./actions", () => ({ saveWhatsappAction: vi.fn(), activateWhatsappAction: vi.fn(), disableWhatsappAction: vi.fn() }));

import ConnectPage from "./page";

const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof ConnectPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme", role });
const ACCOUNT = { configured: true, status: "active", waba_id: "123456789", phone_number_id: "987654321", display_phone: "+91 98765 43210", coexistence: false, token_ref: "SHOP_TOKEN", token_available: true, updated_at: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  getWhatsappAccount.mockResolvedValue(ACCOUNT);
  listTemplates.mockResolvedValue([]);
});

describe("/integrations/whatsapp", () => {
  it("an owner gets the state, the form and the templates", async () => {
    render(await ConnectPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Connect WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Message templates" })).toBeInTheDocument();
  });
  it("an admin reads the state but cannot change it", async () => {
    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await ConnectPage(props()));
    expect(screen.queryByRole("button", { name: "Save details" })).toBeNull();
    expect(screen.getByText("Only the owner can change the number's details.")).toBeInTheDocument();
  });
  it.each(["sales", "viewer"])("a %s is told integrations are for owners and admins", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await ConnectPage(props()));
    expect(screen.getByText("Integrations are shown to owners and admins.")).toBeInTheDocument();
    expect(getWhatsappAccount).not.toHaveBeenCalled();
  });
  it("an account that is not saved yet is 'not connected'", async () => {
    getWhatsappAccount.mockResolvedValue({ configured: false, status: "none" });
    render(await ConnectPage(props()));
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });
  it("a part refused (403) or limited (429) says so in its place; the other stays", async () => {
    getWhatsappAccount.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 15));
    listTemplates.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    render(await ConnectPage(props()));
    expect(screen.getByText(/Wait 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in; an unknown workspace is not found", async () => {
    getWhatsappAccount.mockRejectedValue(new ApiAuthError("x"));
    await expect(ConnectPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ConnectPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
