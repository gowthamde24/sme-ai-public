import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const getPolicyStatus = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/policy", async (orig) => ({ ...(await orig<typeof import("@/lib/api/policy")>()), getPolicyStatus: (...a: unknown[]) => getPolicyStatus(...a) }));
vi.mock("./actions", () => ({ acceptPoliciesAction: vi.fn() }));

import AcceptPage from "./page";

const STATUS = { current: { terms: { version: "2026-11-01", effective_from: null }, privacy: { version: "2026-10-01", effective_from: null } }, accepted: [], needs: { terms: true, privacy: false }, blocking: true };
const props = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", email: "e@example.test", accessToken: "tok" });
  getPolicyStatus.mockResolvedValue(STATUS);
});

describe("/app/accept", () => {
  it("shows what needs accepting", async () => {
    render(await AcceptPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Terms and Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Terms/ })).toBeInTheDocument();
    expect(getPolicyStatus).toHaveBeenCalledWith("tok");
  });
  it("goes on only to a path inside the app", async () => {
    render(await AcceptPage(props({ next: "https://evil.test" })));
    getPolicyStatus.mockResolvedValue({ ...STATUS, needs: { terms: false, privacy: false } });
    render(await AcceptPage(props({ next: "//evil.test" })));
    render(await AcceptPage(props({ next: "/app/tenants/abc" })));
    const links = screen.getAllByRole("link", { name: "Continue" }).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/app", "/app/tenants/abc"]);
  });
  it("a part that cannot be read is said in words; a rejected session goes to sign-in", async () => {
    getPolicyStatus.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    render(await AcceptPage(props()));
    expect(screen.getByText("This part could not be loaded. The rest of the page is fine.")).toBeInTheDocument();
    getPolicyStatus.mockRejectedValue(new ApiAuthError("x"));
    await expect(AcceptPage(props())).rejects.toThrow("/login");
  });
});
