import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const LEAD = "33333333-3333-4333-8333-333333333333";
const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getThread = vi.fn();
const getOutboxSettings = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/whatsapp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/whatsapp")>()), getThread: (...a: unknown[]) => getThread(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), getOutboxSettings: (...a: unknown[]) => getOutboxSettings(...a) }));
vi.mock("../actions", () => ({ replyAction: vi.fn(), approveChatMessageAction: vi.fn(), rejectChatMessageAction: vi.fn(), refreshThreadAction: vi.fn(), markReadAction: vi.fn(async () => ({ ok: true, data: null })) }));

import ChatPage from "./page";

const props = (leadId = LEAD) => ({ params: Promise.resolve({ tenantId: TENANT, leadId }) }) as unknown as Parameters<typeof ChatPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme", role });
const THREAD = { lead_id: LEAD, name: "Ravi Kumar", stopped: false, whatsapp_consent: "granted", window_open: true, window_expires_at: null, next_before: null, items: [{ direction: "in", id: "44444444-4444-4444-8444-444444444444", at: "2026-10-12T08:00:00Z", text: "Hello there" }] };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  getThread.mockResolvedValue(THREAD);
  getOutboxSettings.mockResolvedValue({ platform_switch_on: true, auto_send_enabled: false, per_customer_daily_limit: 3, quiet_hours_start: 21, quiet_hours_end: 9 });
});

describe("/chats/[leadId]", () => {
  it("shows the chat under the customer's name with the business's own quiet hours in the note", async () => {
    render(await ChatPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByText("Messages made between 9 pm and 9 am (India time) wait until the morning.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Customer chats/ })).toHaveAttribute("href", `/app/tenants/${TENANT}/chats`);
    expect(getThread).toHaveBeenCalledWith("tok", TENANT, LEAD);
  });
  it("leaves out the quiet-hours note when the settings cannot be read, and the chat is still there", async () => {
    getOutboxSettings.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    render(await ChatPage(props()));
    expect(screen.queryByText(/wait until the morning/)).toBeNull();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });
  it("a viewer is told this is not theirs", async () => {
    fetchTenant.mockResolvedValue(tenant("viewer"));
    render(await ChatPage(props()));
    expect(screen.getByText(/Customer chats are for the owner/)).toBeInTheDocument();
    expect(getThread).not.toHaveBeenCalled();
  });
  it("an unknown chat is not found; a lead id that is not a uuid is not found", async () => {
    getThread.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(ChatPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ChatPage(props("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it.each([[new ApiRequestError(403, "forbidden", "x"), /does not include this page/], [new ApiRequestError(429, "rate_limited", "x"), /Please wait a minute/]])("a refused (%j) or limited chat says so in words", async (error, words) => {
    getThread.mockRejectedValue(error);
    render(await ChatPage(props()));
    expect(screen.getByText(words)).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in", async () => {
    getThread.mockRejectedValue(new ApiAuthError("x"));
    await expect(ChatPage(props())).rejects.toThrow("/login");
  });
});
