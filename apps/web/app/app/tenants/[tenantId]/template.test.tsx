import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class ForbiddenSignal extends Error {}
const forbidden = vi.fn((): never => {
  throw new ForbiddenSignal("NEXT_HTTP_ERROR_FALLBACK;403");
});
const headerValue = vi.fn();
const requireUser = vi.fn();
const readPack = vi.fn();
vi.mock("next/navigation", () => ({ forbidden: () => forbidden() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k === "x-sme-path" ? headerValue() : null) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/packs/read", () => ({ readPackCached: (...a: unknown[]) => readPack(...a) }));

import { defaultWorkspacePack, otherPackIds, workspacePack } from "@/lib/packs/pack-test-kit";

import WorkspaceTemplate from "./template";

const T = "22222222-2222-2222-2222-222222222222";
const draw = async () => render(await WorkspaceTemplate({ children: <p>the page</p> }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u", accessToken: "tok" });
  readPack.mockResolvedValue(workspacePack(otherPackIds().find((i) => workspacePack(i).modules.includes("fees"))!, "signup", ["today", "fees", "contacts"]));
});

describe("the module guard of a workspace", () => {
  it("answers 403 for a page whose module is OFF for the business type, even when the address was typed in", async () => {
    headerValue.mockReturnValue(`/app/tenants/${T}/orders`);
    await expect(draw()).rejects.toThrow(ForbiddenSignal);
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith("tok", T);
  });
  it("is just as strict for a child page, a record page and a tab of the home", async () => {
    for (const p of ["/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "/quotes", "/enquiries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "/catalogue/new", "/retailers", "/campaigns", "/chats", "?tab=leads"]) {
      headerValue.mockReturnValue(`/app/tenants/${T}${p}`);
      await expect(draw(), p).rejects.toThrow(ForbiddenSignal);
    }
  });
  it("draws the page when the module is on", async () => {
    headerValue.mockReturnValue(`/app/tenants/${T}/fees`);
    await draw();
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(forbidden).not.toHaveBeenCalled();
    headerValue.mockReturnValue(`/app/tenants/${T}?tab=companies`);
    await draw();
    expect(forbidden).not.toHaveBeenCalled();
  });
  it("asks the API nothing for a page that needs no module (Today, Start, Settings, Help), and draws it", async () => {
    for (const p of ["", "/start", "/settings", "/help"]) {
      headerValue.mockReturnValue(`/app/tenants/${T}${p}`);
      await draw();
    }
    expect(readPack).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("judges nothing when there is no pack (a server with no pack routes, or a failed read): the API and the database still refuse", async () => {
    readPack.mockResolvedValue(null);
    headerValue.mockReturnValue(`/app/tenants/${T}/orders`);
    await draw();
    expect(forbidden).not.toHaveBeenCalled();
    expect(screen.getByText("the page")).toBeInTheDocument();
  });
  it("does nothing without a path from the proxy (a test, a request the proxy did not see)", async () => {
    headerValue.mockReturnValue(null);
    await draw();
    expect(readPack).not.toHaveBeenCalled();
    expect(screen.getByText("the page")).toBeInTheDocument();
  });
  it("the default business type keeps every page it always had, and refuses the ones only a pack brings", async () => {
    readPack.mockResolvedValue(defaultWorkspacePack());
    for (const p of ["/orders", "/quotes", "/catalogue", "/retailers", "/chats", "/visits", "/outbox", "/report", "/integrations", "/office", "?tab=companies", "?tab=leads"]) {
      headerValue.mockReturnValue(`/app/tenants/${T}${p}`);
      await draw();
    }
    expect(forbidden).not.toHaveBeenCalled();
    for (const p of ["/fees", "/campaigns"]) {
      headerValue.mockReturnValue(`/app/tenants/${T}${p}`);
      await expect(draw(), p).rejects.toThrow(ForbiddenSignal);
    }
  });
  it("lets a rejected session through to the sign-in redirect that requireUser makes (it is not swallowed here)", async () => {
    headerValue.mockReturnValue(`/app/tenants/${T}/orders`);
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(draw()).rejects.toThrow(/login/);
    expect(forbidden).not.toHaveBeenCalled();
  });
});
