import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const getWorkspacePack = vi.fn();
vi.mock("@/lib/api/pack", async (orig) => ({ ...(await orig<typeof import("@/lib/api/pack")>()), getWorkspacePack: (...a: unknown[]) => getWorkspacePack(...a) }));

import { fixtureWorkspacePack, parseWorkspacePack } from "@/lib/api/pack";

import { readPackCached } from "./read";

beforeEach(() => vi.clearAllMocks());

describe("reading the pack once for a page", () => {
  it("returns what the adapter returned", async () => {
    const p = parseWorkspacePack({ pack: "construction" });
    getWorkspacePack.mockResolvedValue(p);
    expect(await readPackCached("tok", "T")).toBe(p);
  });
  it("counts a failed read as the default pack (a hiccup never takes a page down; the API and the database refuse regardless)", async () => {
    getWorkspacePack.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readPackCached("tok", "T")).toEqual(fixtureWorkspacePack());
    getWorkspacePack.mockRejectedValue(new Error("boom"));
    expect((await readPackCached("tok", "T")).source).toBe("fixture");
  });
  it("passes a rejected session on", async () => {
    getWorkspacePack.mockRejectedValue(new ApiAuthError("no"));
    await expect(readPackCached("tok", "T")).rejects.toThrow(ApiAuthError);
  });
});
