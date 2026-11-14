import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (name: string, parse: (v: unknown) => unknown, fallback: unknown) => (jar.store.has(name) ? (parse(jar.store.get(name)) ?? fallback) : fallback),
  writeJar: async (name: string, value: unknown) => (jar.store.set(name, JSON.parse(JSON.stringify(value))), true),
}));
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/api/call-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/api/call-limit")>()), readCallLimit: api.read, writeCallLimit: api.write }));

import { ApiRequestError } from "@/lib/api/client";

import { readLimit, saveLimit } from "./source";

beforeEach(() => {
  jar.store.clear();
  api.read.mockReset();
  api.write.mockReset();
  vi.unstubAllEnvs();
});

describe("the calls-a-day limit's source", () => {
  it("off: nothing is read and nothing is saved", async () => {
    vi.stubEnv("CALL_LIMIT_SCREENS", "");
    expect(await readLimit("t", "x")).toEqual({ mode: "off" });
    expect(await saveLimit("t", "x", 150)).toEqual({ ok: false, error: "down" });
    expect(api.read).not.toHaveBeenCalled();
  });
  it("mock: the default 100, a made-up 'used today', and a saved number that is kept in the browser", async () => {
    vi.stubEnv("CALL_LIMIT_SCREENS", "mock");
    expect(await readLimit("t", "x")).toMatchObject({ mode: "ok", mock: true, data: { limit: 100, used: 23, remaining: 77, defaultLimit: 100 } });
    expect(await saveLimit("t", "x", 150)).toMatchObject({ ok: true, data: { limit: 150, remaining: 127 } });
    expect(await readLimit("t", "x")).toMatchObject({ data: { limit: 150 } });
  });
  it("a number outside 1 to 5000 (or not whole) is refused before anything is sent", async () => {
    vi.stubEnv("CALL_LIMIT_SCREENS", "1");
    for (const bad of [0, 5001, 1.5, "100", NaN]) expect(await saveLimit("t", "x", bad)).toEqual({ ok: false, error: "range" });
    expect(api.write).not.toHaveBeenCalled();
  });
  it("the API: read as it is, a refusal is a closed word, an unreadable limit is 'unavailable'", async () => {
    vi.stubEnv("CALL_LIMIT_SCREENS", "1");
    api.read.mockResolvedValueOnce({ limit: 100, used: 1, remaining: 99, defaultLimit: 100 });
    expect(await readLimit("t", "x")).toMatchObject({ mode: "ok", mock: false, data: { limit: 100 } });
    api.read.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await readLimit("t", "x")).toEqual({ mode: "unavailable" });
    api.write.mockRejectedValueOnce(new ApiRequestError(403, "forbidden", "x"));
    expect(await saveLimit("t", "x", 150)).toEqual({ ok: false, error: "forbidden" });
    api.write.mockRejectedValueOnce(new ApiRequestError(422, "validation_error", "x"));
    expect(await saveLimit("t", "x", 150)).toEqual({ ok: false, error: "range" });
    api.write.mockRejectedValueOnce(new ApiRequestError(500, "boom", "x"));
    expect(await saveLimit("t", "x", 150)).toEqual({ ok: false, error: "down" });
  });
});
