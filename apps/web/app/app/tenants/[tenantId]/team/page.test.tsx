import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { TENANT } from "@/lib/api/orders-fixtures";
import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getTeam = vi.fn();
const listInvitations = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/team", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/team")>()), getTeam: (...a: unknown[]) => getTeam(...a), listInvitations: (...a: unknown[]) => listInvitations(...a) }));
vi.mock("./actions", () => ({ inviteAction: vi.fn(), revokeInvitationAction: vi.fn(), changeRoleAction: vi.fn(), removeMemberAction: vi.fn() }));

// the JOBS versions of the cards are lazy chunks on a real page; the test draws them at once
vi.mock("@/components/v2/app/settings/simple/Lazy", async () => ({ TeamMembersSimple: (await import("@/components/v2/app/settings/simple/TeamSimple")).TeamMembersSimple, InviteSimple: (await import("@/components/v2/app/settings/simple/TeamSimple")).InviteSimple }));

import TeamPage from "./page";

const props = () => ({ params: Promise.resolve({ tenantId: TENANT }) }) as unknown as Parameters<typeof TeamPage>[0];
const tenant = (role: string) => ({ id: TENANT, name: "Acme Silks", slug: "acme-silks", role });
const TEAM = { members: [{ user_id: "11111111-1111-4111-8111-111111111111", display_name: "Asha", role: "owner", joined_at: null, is_you: true }], pending_invitations: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", email: "e@example.test", accessToken: "tok" });
  fetchTenant.mockResolvedValue(tenant("owner"));
  getTeam.mockResolvedValue(TEAM);
  listInvitations.mockResolvedValue([]);
});

describe("/team", () => {
  it("an owner sees the people, the invitation form and the invitations", async () => {
    render(await TeamPage(props()));
    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    for (const name of ["People", "Invite a person", "Invitations"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(getTeam).toHaveBeenCalledWith("tok", TENANT);
    expect(listInvitations).toHaveBeenCalledWith("tok", TENANT);
  });
  it.each(["sales", "viewer"])("a %s sees the people only, and the invitations are not asked for", async (role) => {
    fetchTenant.mockResolvedValue(tenant(role));
    render(await TeamPage(props()));
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invite a person" })).toBeNull();
    expect(listInvitations).not.toHaveBeenCalled();
  });
  it("a part refused (403) or limited (429) says so in its place and the other stays", async () => {
    getTeam.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x", undefined, undefined, 40));
    listInvitations.mockRejectedValue(new ApiRequestError(403, "forbidden", "x"));
    render(await TeamPage(props()));
    expect(screen.getByText(/Wait 40 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Your role does not include this page. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invite a person" })).toBeInTheDocument();
  });
  it("a rejected session goes to sign-in; an unknown workspace is not found", async () => {
    getTeam.mockRejectedValue(new ApiAuthError("x"));
    await expect(TeamPage(props())).rejects.toThrow("/login");
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    await expect(TeamPage(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/team under JOBS (the simplicity pass)", () => {
  const withJobs = async (run: () => Promise<void>) => {
    process.env.JOBS = "mock";
    try {
      await run();
    } finally {
      delete process.env.JOBS;
    }
  };
  it("JOBS off: the cards of before (a Role select and a Change role button per person, the form with its labels)", async () => {
    getTeam.mockResolvedValue({ ...TEAM, members: [...TEAM.members, { user_id: "22222222-aaaa-4aaa-8aaa-000000000001", display_name: "Ravi", role: "sales", joined_at: null, is_you: false }] });
    render(await TeamPage(props()));
    expect(screen.getByRole("button", { name: "Change role" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Role")).toHaveLength(2); // one on the person, one on the invitation form
    expect(screen.getByRole("button", { name: "Make an invitation code" })).toBeInTheDocument();
    expect(screen.queryByText("What it will do:")).toBeNull();
  });
  it("JOBS on: each person and the invitation are sentences with the choice inside; the invitations list stays", async () => {
    await withJobs(async () => {
      getTeam.mockResolvedValue({ ...TEAM, members: [...TEAM.members, { user_id: "22222222-aaaa-4aaa-8aaa-000000000001", display_name: "Ravi", role: "sales", joined_at: null, is_you: false }] });
      render(await TeamPage(props()));
      expect(document.querySelector("[data-team=members] [data-setting-line=member]")).toHaveTextContent("You are the owner.");
      expect(screen.getByRole("combobox", { name: "Ravi: Role" })).toHaveValue("sales");
      expect(screen.getByRole("combobox", { name: /Invite someone as/ })).toBeInTheDocument();
      expect(screen.getByText("What it will do:")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Invitations" })).toBeInTheDocument();
    });
  });
  it("JOBS on: a person who may not invite sees the people only", async () => {
    await withJobs(async () => {
      fetchTenant.mockResolvedValue(tenant("viewer"));
      render(await TeamPage(props()));
      expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Invite a person" })).toBeNull();
    });
  });
});

describe("a refused or rate-limited read goes to the friendly pages (job CC, screen 7)", () => {
  it.each([[403, "/app/problem/403"], [429, "/app/problem/429"]])("the workspace read answering %i goes to %s", async (status, to) => {
    fetchTenant.mockRejectedValue(new ApiRequestError(status, status === 429 ? "rate_limited" : "forbidden", "x"));
    await expect(TeamPage(props())).rejects.toThrow(`NEXT_REDIRECT:${to}`);
  });
});
