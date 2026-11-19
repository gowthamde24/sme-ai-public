import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError } from "@/lib/api/client";
import type { LeadRow } from "@/lib/leads-v6/rows";

/**
 * The Leads page of the design system v6 sends its heading (the title and the line under it, the first thing read) before the leads are read, with a placeholder of the same size where the leads go, and says the one quiet sentence when they cannot be read.
 */
const readLeadsV6 = vi.fn();
const readTouches = vi.fn();
const readHandoffs = vi.fn();
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), notFound: () => undefined, useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/outreach/source", async (orig) => ({ ...(await orig<typeof import("@/lib/outreach/source")>()), readHandoffs: (...a: unknown[]) => readHandoffs(...a) }));
vi.mock("./v6-data", () => ({ readLeadsV6: (...a: unknown[]) => readLeadsV6(...a), readTouches: (...a: unknown[]) => readTouches(...a) }));

import { LeadsV6Page } from "./v6";

const ctx = { accessToken: "tok", userId: "u1", tenantId: "22222222-2222-2222-2222-222222222222", tenant: { id: "22222222-2222-2222-2222-222222222222", name: "Acme", slug: "acme", role: "owner" as const }, pack: null };
const ROW: LeadRow = { key: "l-1", kind: "lead", id: "1", name: "Ravi K.", chip: "new", source: "indiamart", nearby: false, line: "Paver blocks · Gandhi Nagar", at: "2026-11-05T05:00:00Z", hot: false, isNew: true, phone: null, ownerUserId: null };

function deferred<V>() {
  let resolve!: (v: V) => void;
  const promise = new Promise<V>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};
const show = async (role: "owner" | "viewer" = "owner") => {
  const element = await LeadsV6Page({ ctx: { ...ctx, tenant: { ...ctx.tenant, role } }, query: {} });
  await act(async () => void render(element));
  await flush();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OUTREACH_SCREENS", "1");
  readHandoffs.mockResolvedValue([]);
  readTouches.mockResolvedValue(null);
  readLeadsV6.mockResolvedValue({ rows: [ROW], nextCursor: null, unavailable: false, mock: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the Leads page draws its heading before the leads", () => {
  it("has the title and the line under it at once, a placeholder where the leads go, and the leads when they are read", async () => {
    const read = deferred<unknown>();
    readLeadsV6.mockReturnValue(read.promise);
    await show();
    expect(document.querySelector("h1")).toHaveTextContent("Leads");
    expect(document.body).toHaveTextContent("Everyone who asked about your business, and businesses found near you.");
    expect(document.querySelector("[data-placeholder]")).not.toBeNull();
    expect(document.querySelector("[data-placeholder]")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector('[data-part="leads-table"]')).toBeNull();
    await act(async () => read.resolve({ rows: [ROW], nextCursor: null, unavailable: false, mock: false }));
    await flush();
    expect(document.querySelector("[data-placeholder]")).toBeNull();
    expect(document.querySelector('[data-part="leads-table"]')).toHaveTextContent("Ravi K.");
    expect(document.body).toHaveTextContent("Everyone who asked about your business, and businesses found near you."); // the heading did not change
  });

  it("asks for each thing once: the handoffs (not for a Viewer), the leads, no history unless a row is open", async () => {
    await show();
    expect(readHandoffs).toHaveBeenCalledTimes(1);
    expect(readLeadsV6).toHaveBeenCalledTimes(1);
    expect(readTouches).not.toHaveBeenCalled();
    cleanup();
    vi.clearAllMocks();
    readLeadsV6.mockResolvedValue({ rows: [ROW], nextCursor: null, unavailable: false, mock: false });
    await show("viewer");
    expect(readHandoffs).not.toHaveBeenCalled();
    expect(readLeadsV6).toHaveBeenCalledTimes(1);
  });

  it("a Viewer sees no 'Add a lead'; everyone else does, in the heading", async () => {
    await show("viewer");
    expect(document.querySelector('a[href$="/add-lead"]')).toBeNull();
    cleanup();
    await show("owner");
    expect(document.querySelector('a[href$="/add-lead"]')).not.toBeNull();
  });
});

describe("a read that fails", () => {
  it("says the one quiet sentence with the way out, under the same heading", async () => {
    readLeadsV6.mockRejectedValue(new Error("down"));
    await show();
    expect(document.querySelector("h1")).toHaveTextContent("Leads");
    const alert = document.querySelector('[role="alert"]');
    expect(alert).toHaveTextContent("Leads are not available right now. Try again in a minute.");
    expect(alert).toHaveTextContent("Try again");
    expect(document.querySelector("[data-placeholder]")).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("the page's own 'could not be read' answer is the same sentence", async () => {
    readLeadsV6.mockResolvedValue({ rows: [], nextCursor: null, unavailable: true, mock: false });
    await show();
    expect(document.querySelector('[role="alert"]')).toHaveTextContent("Leads are not available right now. Try again in a minute.");
  });

  it("a rejected session still goes to the sign-in page", async () => {
    readLeadsV6.mockRejectedValue(new ApiAuthError());
    await show();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
