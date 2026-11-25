import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { extraLines } from "@/lib/screens/flag";

const api = vi.hoisted(() => ({ readOverview: vi.fn(), addLine: vi.fn(), changeLine: vi.fn() }));
vi.mock("@/lib/api/extra-lines", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/extra-lines")>()), readOverview: api.readOverview, addLine: api.addLine, changeLine: api.changeLine }));
const jar = vi.hoisted(() => ({ value: null as unknown, writes: [] as unknown[] }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (_n: string, parse: (v: unknown) => unknown, fallback: unknown) => (jar.value === null ? fallback : (parse(jar.value) ?? fallback)),
  writeJar: async (_n: string, v: unknown) => {
    jar.value = v;
    jar.writes.push(v);
    return true;
  },
}));

import { parseOverview } from "@/lib/api/extra-lines";

import { addExtraLine, moveExtraLine, readExtraLines } from "./source";
import { MOCK_CREDITS, MOCK_PRICE, isKey, mockOverview } from "./types";

const T = "11111111-1111-4111-8111-111111111111";
const LINE = "22222222-2222-4222-8222-222222222222";
const KEY = "press-0001-abcdef";
const GOOD = {
  enabled: true,
  price_rupees: 149,
  cap: 20,
  numbers: 1,
  included: 2,
  total: 3,
  can_add: true,
  extra: [{ id: LINE, status: "active", working: true, paid_until: "2026-12-26T00:00:00Z", cancel_at_period_end: false, grace_until: null }],
};
const ENV = { EXTRA_LINES: process.env.EXTRA_LINES };
beforeEach(() => {
  api.readOverview.mockReset();
  api.addLine.mockReset();
  api.changeLine.mockReset();
  jar.value = null;
  jar.writes = [];
});
afterEach(() => {
  if (ENV.EXTRA_LINES === undefined) delete process.env.EXTRA_LINES;
  else process.env.EXTRA_LINES = ENV.EXTRA_LINES;
});

describe("the answer of GET /extra-lines (docs/contracts/extra-lines.md)", () => {
  it("is read as the price in rupees, the limit, the lines and each extra line", () => {
    expect(parseOverview(GOOD)).toEqual({
      enabled: true,
      priceRupees: 149,
      cap: 20,
      numbers: 1,
      included: 2,
      total: 3,
      canAdd: true,
      extra: [{ id: LINE, status: "active", working: true, paidUntil: "2026-12-26T00:00:00Z", cancelAtEnd: false, graceUntil: null }],
    });
  });
  it.each([
    ["not an object", [1]],
    ["a price that is text", { ...GOOD, price_rupees: "149" }],
    ["a status outside the contract", { ...GOOD, extra: [{ ...GOOD.extra[0], status: "bought" }] }],
    ["a line without an id", { ...GOOD, extra: [{ ...GOOD.extra[0], id: "x" }] }],
    ["a negative total", { ...GOOD, total: -1 }],
  ])("refuses %s", (_name, body) => {
    expect(() => parseOverview(body)).toThrow();
  });
  it("the made-up answer of the test screen is itself a valid answer", () => {
    const mock = mockOverview(2, 1, Date.UTC(2026, 10, 26));
    const wire = { enabled: mock.enabled, price_rupees: mock.priceRupees, cap: mock.cap, numbers: mock.numbers, included: mock.included, total: mock.total, can_add: mock.canAdd, extra: mock.extra.map((l) => ({ id: l.id, status: l.status, working: l.working, paid_until: l.paidUntil, cancel_at_period_end: l.cancelAtEnd, grace_until: l.graceUntil })) };
    expect(parseOverview(wire)).toEqual(mock);
    expect(mock.total).toBe(4);
  });
});

describe("the switch", () => {
  it("reads only an exact `1`, or `mock`", () => {
    expect(extraLines("1")).toBe("on");
    expect(extraLines("mock")).toBe("mock");
    for (const v of [undefined, "", "0", "true", "on"]) expect(extraLines(v), String(v)).toBe("off");
  });
  it("is declared like the others: on as a made-up answer in staging, absent from production", () => {
    const DEPLOY = path.resolve(__dirname, "../../../../deploy");
    const flags = (file: string): Record<string, string> =>
      Object.fromEntries(fs.readFileSync(path.join(DEPLOY, file), "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    expect(flags("staging-web-flags.env").EXTRA_LINES).toBe("mock");
    for (const file of ["production-web-flags.env", "settings/production/web.env"]) expect(Object.keys(flags(file)), file).not.toContain("EXTRA_LINES");
    for (const file of ["settings/production/api.env"]) expect(Object.keys(flags(file)), file).not.toContain("EXTRA_LINES");
  });
});

describe("where the card gets its lines", () => {
  it("is off by default: nothing is read and nothing can be added", async () => {
    delete process.env.EXTRA_LINES;
    expect(await readExtraLines("tok", T)).toEqual({ mode: "off" });
    expect(await addExtraLine("tok", T, KEY)).toEqual({ ok: false, error: "invalid" });
    expect(api.readOverview).not.toHaveBeenCalled();
    expect(api.addLine).not.toHaveBeenCalled();
  });
  it("on: C1's route with the person's token; a server whose platform switch is off (enabled false) is the card as it was", async () => {
    process.env.EXTRA_LINES = "1";
    api.readOverview.mockResolvedValue(parseOverview(GOOD));
    expect(await readExtraLines("tok", T)).toMatchObject({ mode: "ok", mock: false, data: { total: 3, priceRupees: 149 } });
    expect(api.readOverview).toHaveBeenCalledWith("tok", T);
    api.readOverview.mockResolvedValue({ ...parseOverview(GOOD), enabled: false });
    expect(await readExtraLines("tok", T)).toEqual({ mode: "off" });
  });
  it("a sign-in problem is the caller's; an older server (404) or a failure is 'unread', never a guess", async () => {
    process.env.EXTRA_LINES = "1";
    const auth = new ApiAuthError("expired");
    api.readOverview.mockRejectedValueOnce(auth);
    await expect(readExtraLines("tok", T)).rejects.toBe(auth);
    api.readOverview.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await readExtraLines("tok", T)).toEqual({ mode: "unread" });
    api.readOverview.mockRejectedValue(new Error("boom"));
    expect(await readExtraLines("tok", T)).toEqual({ mode: "unread" });
  });
});

describe("adding a line", () => {
  it("the key of one press is 8 to 64 letters, digits, dash or underscore, and nothing else is sent", async () => {
    for (const bad of [undefined, "", "short", "has space in it!", "x".repeat(65), 12345678]) expect(isKey(bad), String(bad)).toBe(false);
    expect(isKey(KEY)).toBe(true);
    process.env.EXTRA_LINES = "1";
    expect(await addExtraLine("tok", T, "has space in it!")).toEqual({ ok: false, error: "invalid" });
    expect(api.addLine).not.toHaveBeenCalled();
  });
  it("on: the line is asked for with the person's token and the key", async () => {
    process.env.EXTRA_LINES = "1";
    api.addLine.mockResolvedValue({});
    expect(await addExtraLine("tok", T, KEY)).toEqual({ ok: true });
    expect(api.addLine).toHaveBeenCalledWith("tok", T, KEY);
  });
  it.each([
    [new ApiRequestError(409, "lines_unavailable", "x", "not_enough_credits"), { ok: false, error: "unavailable", reason: "not_enough_credits" }],
    [new ApiRequestError(409, "lines_unavailable", "x", undefined, undefined, undefined, { fields: ["at_limit"] }), { ok: false, error: "unavailable", reason: "at_limit" }],
    [new ApiRequestError(409, "lines_unavailable", "x", "something_new"), { ok: false, error: "unavailable", reason: undefined }],
    [new ApiRequestError(403, "step_up_required", "x"), { ok: false, error: "step_up" }],
    [new ApiRequestError(403, "forbidden", "x"), { ok: false, error: "forbidden" }],
    [new ApiRequestError(404, "not_found", "x"), { ok: false, error: "unavailable", reason: "not_found" }],
    [new Error("down"), { ok: false, error: "down" }],
  ])("a refusal (%#) is a closed word", async (error, expected) => {
    process.env.EXTRA_LINES = "1";
    api.addLine.mockRejectedValue(error);
    expect(await addExtraLine("tok", T, KEY)).toEqual(expected);
  });
  it("mock: three lines are paid from the made-up credits, the fourth is refused; nothing is sent to the API", async () => {
    process.env.EXTRA_LINES = "mock";
    expect(MOCK_CREDITS - 3 * MOCK_PRICE).toBeLessThan(MOCK_PRICE);
    for (let i = 0; i < 3; i += 1) expect(await addExtraLine("tok", T, KEY)).toEqual({ ok: true });
    expect(await addExtraLine("tok", T, KEY)).toEqual({ ok: false, error: "unavailable", reason: "not_enough_credits" });
    expect(api.addLine).not.toHaveBeenCalled();
    const seen = await readExtraLines("tok", T);
    expect(seen).toMatchObject({ mode: "ok", mock: true, data: { total: 5 } });
  });
});

describe("cancelling and keeping", () => {
  it("on: the move goes to the API for a real line id only", async () => {
    process.env.EXTRA_LINES = "1";
    api.changeLine.mockResolvedValue({});
    expect(await moveExtraLine("tok", T, LINE, "cancel")).toEqual({ ok: true });
    expect(api.changeLine).toHaveBeenCalledWith("tok", T, LINE, "cancel");
    expect(await moveExtraLine("tok", T, "not-an-id", "keep")).toEqual({ ok: false, error: "invalid" });
  });
  it("mock: a line is cancelled, then kept again", async () => {
    process.env.EXTRA_LINES = "mock";
    await addExtraLine("tok", T, KEY);
    const id = mockOverview(1, 0).extra[0].id;
    expect(await moveExtraLine("tok", T, id, "cancel")).toEqual({ ok: true });
    expect((await readExtraLines("tok", T)) as { data: { extra: { cancelAtEnd: boolean }[] } }).toMatchObject({ data: { extra: [{ cancelAtEnd: true }] } });
    expect(await moveExtraLine("tok", T, id, "keep")).toEqual({ ok: true });
    expect((await readExtraLines("tok", T)) as { data: { extra: { cancelAtEnd: boolean }[] } }).toMatchObject({ data: { extra: [{ cancelAtEnd: false }] } });
    expect(await moveExtraLine("tok", T, mockOverview(5, 0).extra[4].id, "cancel")).toEqual({ ok: false, error: "unavailable", reason: "not_found" });
  });
});
