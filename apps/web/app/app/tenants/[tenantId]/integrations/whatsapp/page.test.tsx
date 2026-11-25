import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getWhatsappAccount = vi.fn();
const getConnectConfig = vi.fn();
const listTemplates = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/v2/app/whatsapp/LazyConnectWithFacebook", async () => ({ ConnectWithFacebook: (await import("@/components/v2/app/whatsapp/ConnectWithFacebook")).ConnectWithFacebook }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/whatsapp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/whatsapp")>()), getWhatsappAccount: (...a: unknown[]) => getWhatsappAccount(...a), getConnectConfig: (...a: unknown[]) => getConnectConfig(...a), listTemplates: (...a: unknown[]) => listTemplates(...a) }));
vi.mock("./actions", () => ({ connectWithFacebookAction: vi.fn(), saveWhatsappAction: vi.fn(), activateWhatsappAction: vi.fn(), disableWhatsappAction: vi.fn(), disconnectWhatsappAction: vi.fn(), submitDraftsAction: vi.fn(), submitTemplateAction: vi.fn(), syncTemplatesAction: vi.fn() }));

import ConnectPage from "./page";

const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof ConnectPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme", role });
const ACCOUNT = { configured: true, status: "active", waba_id: "123456789", phone_number_id: "987654321", display_phone: "+91 98765 43210", coexistence: false, token_ref: "SHOP_TOKEN", token_available: true, updated_at: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  getWhatsappAccount.mockResolvedValue(ACCOUNT);
  getConnectConfig.mockResolvedValue(null);
  listTemplates.mockResolvedValue([]);
});

describe("/integrations/whatsapp", () => {
  it("an owner gets the state and the form; the templates are not here any more, a line says where they went (owner, 16 Nov)", async () => {
    render(await ConnectPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Connect WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Message templates" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Templates" })).toHaveAttribute("href", `/app/tenants/${TENANT}/chats/templates`);
    expect(listTemplates).not.toHaveBeenCalled();
  });
  it("the owner sees the Connect with Facebook card when the API says it is ready; the manual form is under More choices", async () => {
    getConnectConfig.mockResolvedValue({ available: true, appId: "APP1", configId: "CFG1", graphVersion: "v25.0", missing: [], onboardingTypes: ["cloud_api", "coexistence"] });
    render(await ConnectPage(props()));
    expect(await screen.findByRole("button", { name: "Connect with Facebook" })).toBeInTheDocument();
    expect(screen.getByText("More choices (for support only)")).toBeInTheDocument();
    expect(document.querySelector('[data-part="manual-connect"]')).not.toHaveAttribute("open");
  });
  it("without a configuration (staging today) it says WhatsApp connect is being set up and draws no button", async () => {
    getConnectConfig.mockResolvedValue({ available: false, appId: null, configId: null, graphVersion: "v25.0", missing: ["app_id", "config_id"], onboardingTypes: [] });
    render(await ConnectPage(props()));
    expect(screen.getByText("WhatsApp connect is being set up. The button will be here soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect with Facebook" })).toBeNull();
    cleanup();
    getConnectConfig.mockResolvedValue(null);
    render(await ConnectPage(props()));
    expect(screen.getByText(/being set up/)).toBeInTheDocument();
  });
  it("an admin is not asked for the configuration and sees no connect card", async () => {
    fetchTenant.mockResolvedValue(tenant("admin"));
    render(await ConnectPage(props()));
    expect(getConnectConfig).not.toHaveBeenCalled();
    expect(screen.queryByText(/being set up/)).toBeNull();
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
  it("a number that is limited (429) says so in its place", async () => {
    getWhatsappAccount.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 15));
    render(await ConnectPage(props()));
    expect(screen.getByText(/Wait 15 seconds/)).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in; an unknown workspace is not found", async () => {
    getWhatsappAccount.mockRejectedValue(new ApiAuthError("x"));
    await expect(ConnectPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ConnectPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
