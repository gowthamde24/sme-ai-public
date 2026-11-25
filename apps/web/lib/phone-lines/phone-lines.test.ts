import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { callsPanel, phoneLinesScreens } from "@/lib/screens/flag";

const api = vi.hoisted(() => ({ readLines: vi.fn() }));
vi.mock("@/lib/api/phone-lines", () => ({ readLines: api.readLines }));

import { readPhoneLines } from "./source";
import { MAX_LINES, MOCK_LINES, parseLines } from "./types";

const T = "11111111-1111-4111-8111-111111111111";
const GOOD = { total: 3, in_use: 1, lines: [{ n: 1, state: "on_call" }, { n: 2, state: "open" }, { n: 3, state: "open" }] };

describe("the answer of GET /phone-lines (docs/contracts/calls.md)", () => {
  it("is read as total, in use and one tile per line", () => {
    expect(parseLines(GOOD)).toEqual({ total: 3, inUse: 1, lines: [{ n: 1, state: "on_call" }, { n: 2, state: "open" }, { n: 3, state: "open" }] });
  });
  it("a server without telephony answers nothing at all: total 0 is a plain empty answer", () => {
    expect(parseLines({ total: 0, in_use: 0, lines: [] })).toEqual({ total: 0, inUse: 0, lines: [] });
  });
  it("the tiles follow the counts: a mislabelled tile cannot disagree with the number beside it", () => {
    const odd = { total: 2, in_use: 0, lines: [{ n: 1, state: "on_call" }, { n: 2, state: "on_call" }] };
    expect(parseLines(odd)?.lines.map((l) => l.state)).toEqual(["open", "open"]);
  });
  it.each([
    ["not an object", [1]],
    ["null", null],
    ["more lines than a workspace can have (100)", { total: MAX_LINES + 1, in_use: 0, lines: Array.from({ length: MAX_LINES + 1 }, (_, i) => ({ n: i + 1, state: "open" })) }],
    ["in use above total", { total: 1, in_use: 2, lines: [{ n: 1, state: "open" }] }],
    ["negative", { total: 1, in_use: -1, lines: [{ n: 1, state: "open" }] }],
    ["a tile count that is not the total", { total: 2, in_use: 0, lines: [{ n: 1, state: "open" }] }],
    ["two tiles with one number", { total: 2, in_use: 0, lines: [{ n: 1, state: "open" }, { n: 1, state: "open" }] }],
    ["a state outside the contract", { total: 1, in_use: 0, lines: [{ n: 1, state: "ringing" }] }],
    ["a fractional total", { total: 1.5, in_use: 0, lines: [] }],
  ])("refuses %s", (_name, body) => {
    expect(parseLines(body)).toBeNull();
  });
  it("the made-up answer of the test screen is itself a valid answer", () => {
    expect(parseLines({ total: MOCK_LINES.total, in_use: MOCK_LINES.inUse, lines: MOCK_LINES.lines })).toEqual(MOCK_LINES);
  });
});

describe("where the card gets its lines", () => {
  const ENV = { CALLS_PANEL: process.env.CALLS_PANEL, PHONE_LINES_SCREENS: process.env.PHONE_LINES_SCREENS };
  beforeEach(() => api.readLines.mockReset());
  afterEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  it("is off by default: both flags unset, nothing is read", async () => {
    delete process.env.CALLS_PANEL;
    delete process.env.PHONE_LINES_SCREENS;
    expect(callsPanel()).toBe(false);
    expect(phoneLinesScreens()).toBe("off");
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "off" });
    expect(api.readLines).not.toHaveBeenCalled();
  });
  it("is off without CALLS_PANEL even when the lines flag is on", async () => {
    delete process.env.CALLS_PANEL;
    process.env.PHONE_LINES_SCREENS = "1";
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "off" });
  });
  it("mock: a made-up two-line answer, nothing is read", async () => {
    process.env.CALLS_PANEL = "1";
    process.env.PHONE_LINES_SCREENS = "mock";
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "ok", lines: MOCK_LINES, mock: true });
    expect(api.readLines).not.toHaveBeenCalled();
  });
  it("on: C1's route, with the person's token", async () => {
    process.env.CALLS_PANEL = "1";
    process.env.PHONE_LINES_SCREENS = "1";
    api.readLines.mockResolvedValue(parseLines(GOOD));
    const got = await readPhoneLines("tok", T);
    expect(got).toMatchObject({ mode: "ok", mock: false, lines: { total: 3, inUse: 1 } });
    expect(api.readLines).toHaveBeenCalledWith("tok", T);
  });
  it("a sign-in problem is the caller's (it sends the person to the login page)", async () => {
    process.env.CALLS_PANEL = "1";
    process.env.PHONE_LINES_SCREENS = "1";
    const auth = new ApiAuthError("expired");
    api.readLines.mockRejectedValueOnce(auth);
    await expect(readPhoneLines("tok", T)).rejects.toBe(auth);
  });
  it("an older server (404), a failure or an answer that does not add up is 'unread', never a guess", async () => {
    process.env.CALLS_PANEL = "1";
    process.env.PHONE_LINES_SCREENS = "1";
    api.readLines.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "unread" });
    api.readLines.mockRejectedValue(new Error("boom"));
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "unread" });
    api.readLines.mockResolvedValue(null);
    expect(await readPhoneLines("tok", T)).toEqual({ mode: "unread" });
  });
});

describe("the flags are declared like the others", () => {
  const DEPLOY = path.resolve(__dirname, "../../../../deploy");
  const flags = (file: string): Record<string, string> =>
    Object.fromEntries(
      fs
        .readFileSync(path.join(DEPLOY, file), "utf8")
        .split("\n")
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  it("are on in staging (the panel for real, the lines as a made-up answer) and absent from production", () => {
    const staging = flags("staging-web-flags.env");
    expect(staging.CALLS_PANEL).toBe("1");
    expect(staging.PHONE_LINES_SCREENS).toBe("mock");
    for (const file of ["production-web-flags.env", "settings/production/web.env"]) {
      expect(Object.keys(flags(file)), file).not.toContain("CALLS_PANEL");
      expect(Object.keys(flags(file)), file).not.toContain("PHONE_LINES_SCREENS");
    }
  });
  it("read only an exact `1` (or `mock` for the lines)", () => {
    expect(callsPanel("1")).toBe(true);
    for (const v of [undefined, "", "0", "true", "mock", "on"]) expect(callsPanel(v), String(v)).toBe(false);
    expect(phoneLinesScreens("mock")).toBe("mock");
    expect(phoneLinesScreens("1")).toBe("on");
    for (const v of [undefined, "", "0", "true"]) expect(phoneLinesScreens(v), String(v)).toBe("off");
  });
});
