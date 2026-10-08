import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { redirectMock, redirectTarget } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchStatus = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/suppression", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/suppression")>()),
  fetchSuppressionStatus: (...a: unknown[]) => fetchStatus(...a),
}));
vi.mock("./actions", () => ({ backfillKeysAction: vi.fn(async () => undefined) }));

import SuppressionPage from "./page";

const TENANT = "22222222-2222-2222-2222-222222222222";
const tenant = (role: string) => ({ id: TENANT, name: "Acme", slug: "acme", role });
const status = (unkeyed: number | null, over: Record<string, unknown> = {}) => ({ key_configured: true, key_version: 1, unkeyed_contacts: unkeyed, ...over });
const props = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) }) as unknown as Parameters<typeof SuppressionPage>[0];
const BUTTON = "Record keys for contacts that have none";
const CLEAR = /No contact is waiting for a key/;

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal2" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  fetchStatus.mockResolvedValue(status(7));
});

describe("the suppression keys page: who sees it", () => {
  it.each(["admin", "sales", "viewer"])("a %s is told who records keys, and the API is not asked for the status", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await SuppressionPage(props()));
    expect(screen.getByText("Only the owner records suppression keys.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("an owner with a second factor sees the count and the button", async () => {
    render(await SuppressionPage(props()));
    expect(screen.getByRole("heading", { name: "Suppression keys" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
    expect(fetchTenant).toHaveBeenCalledWith("tok", TENANT);
    expect(fetchStatus).toHaveBeenCalledWith("tok", TENANT);
  });

  it("an owner WITHOUT the second factor sees the status, the reason and no button", async () => {
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok", aal: "aal1" });
    render(await SuppressionPage(props()));
    expect(screen.getByText(/7 contacts have no suppression key/)).toBeInTheDocument();
    expect(screen.getByText(/Recording keys needs your authenticator app/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set it up on the Security page" })).toHaveAttribute("href", "/app/security");
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("a malformed workspace id and another workspace's are the same not-found; a rejected session goes to sign-in; an outage is plain", async () => {
    await expect(SuppressionPage(props("x"))).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(SuppressionPage(props())).rejects.toThrow("not found");
    fetchTenant.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => SuppressionPage(props()))).toBe("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await SuppressionPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API.");
  });

  it("a rejected session on the status call goes to sign-in too", async () => {
    fetchStatus.mockRejectedValue(new ApiAuthError("no"));
    expect(await redirectTarget(() => SuppressionPage(props()))).toBe("/login");
  });
});

describe("the hard gate: it never reads as ready while a contact has no key", () => {
  it.each([1, 2, 7, 500])("with %i unkeyed it says NOT ready, shows the number and never the clear sentence", async (n) => {
    fetchStatus.mockResolvedValue(status(n));
    render(await SuppressionPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("NOT ready.");
    expect(screen.getByRole("alert")).toHaveTextContent(`${n} ${n === 1 ? "contact has" : "contacts have"} no suppression key`);
    expect(screen.queryByText(CLEAR)).toBeNull();
  });

  it("an unknown count (null) is NOT ready, with no number", async () => {
    fetchStatus.mockResolvedValue(status(null));
    render(await SuppressionPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("NOT ready.");
    expect(screen.getByRole("alert")).toHaveTextContent("not known");
    expect(screen.queryByText(CLEAR)).toBeNull();
  });

  it("no key on the server is NOT ready and offers no button, even if the count says zero", async () => {
    fetchStatus.mockResolvedValue(status(0, { key_configured: false, key_version: null }));
    render(await SuppressionPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("NOT ready.");
    expect(screen.getByRole("alert")).toHaveTextContent("not set up on the server");
    expect(screen.queryByText(CLEAR)).toBeNull();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it.each([
    ["an outage", new ApiRequestError(503, "api_unreachable", "x")],
    ["the key being unavailable", new ApiRequestError(503, "suppression_unavailable", "x")],
    ["a body that breaks the contract", new ApiContractError("suppression status")],
    ["a 403", new ApiRequestError(403, "forbidden", "x")],
  ])("%s is NOT ready: no number, no clear sentence, no button", async (_name, error) => {
    fetchStatus.mockRejectedValue(error);
    render(await SuppressionPage(props()));
    expect(screen.getByRole("alert")).toHaveTextContent("NOT ready.");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read the suppression status");
    expect(screen.queryByText(CLEAR)).toBeNull();
    expect(screen.queryByText(/Checked/)).toBeNull();
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("only a configured key with exactly zero unkeyed reads as clear, and even then it says it is one condition and not the real-data gate", async () => {
    fetchStatus.mockResolvedValue(status(0));
    render(await SuppressionPage(props()));
    expect(screen.getByText(CLEAR)).toBeInTheDocument();
    expect(screen.getByText(/does not open the real-data gate/)).toBeInTheDocument();
    expect(screen.queryByText(/NOT ready/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the word ready never appears except in 'NOT ready'", async () => {
    for (const s of [status(0), status(3), status(null), status(0, { key_configured: false })]) {
      fetchStatus.mockResolvedValue(s);
      const { container, unmount } = render(await SuppressionPage(props()));
      const text = container.textContent ?? "";
      expect(text.replace(/NOT ready/g, "")).not.toMatch(/\bready\b/i);
      unmount();
    }
  });
});

describe("it shows only counts", () => {
  it("renders no key, hash, address or phone number even if the API's object carried one (the parser refuses it; the page never reads it)", async () => {
    fetchStatus.mockResolvedValue(status(3));
    const { container } = render(await SuppressionPage(props()));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/@|hmac|[0-9a-f]{32}|\+?\d{10}/i);
    expect(text).toMatch(/Key version in use: 1\./);
  });
});
