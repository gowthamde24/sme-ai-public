import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { fetchSuppressionStatus, parseBackfill, parseStatus, runBackfill, suppressionReadiness } from "./suppression";

const TENANT = "22222222-2222-2222-2222-222222222222";
const STATUS = { key_configured: true, key_version: 1, unkeyed_contacts: 7 };
const DONE = { recorded: 3, skipped: 0, flagged: 0, unkeyable: 1, remaining: 4 };

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

afterEach(() => vi.clearAllMocks());

describe("parsing is strict", () => {
  it("accepts the API's bodies", () => {
    expect(parseStatus(STATUS)).toEqual(STATUS);
    expect(parseStatus({ key_configured: false, key_version: null, unkeyed_contacts: null })).toEqual({ key_configured: false, key_version: null, unkeyed_contacts: null });
    expect(parseBackfill(DONE)).toEqual(DONE);
  });
  it.each([
    ["an unknown field (so nothing new can be rendered by accident)", { ...STATUS, hmac: "CANARY" }],
    ["a missing field", { key_configured: true, key_version: 1 }],
    ["a negative count", { ...STATUS, unkeyed_contacts: -1 }],
    ["a fractional count", { ...STATUS, unkeyed_contacts: 1.5 }],
    ["a count as text", { ...STATUS, unkeyed_contacts: "0" }],
    ["a flag as text", { ...STATUS, key_configured: "true" }],
    ["a list", []],
    ["null", null],
  ])("refuses a status with %s", (_name, body) => {
    expect(() => parseStatus(body)).toThrow(ApiContractError);
  });
  it.each([
    ["an unknown field", { ...DONE, email: "x@example.test" }],
    ["a missing field", { recorded: 1 }],
    ["a negative count", { ...DONE, remaining: -1 }],
    ["a count as text", { ...DONE, recorded: "3" }],
  ])("refuses a backfill result with %s", (_name, body) => {
    expect(() => parseBackfill(body)).toThrow(ApiContractError);
  });
});

describe("suppressionReadiness: nothing unknown can read as clear", () => {
  it.each([
    [null, "unavailable"],
    [{ key_configured: false, key_version: null, unkeyed_contacts: 0 }, "no_key"],
    [{ key_configured: false, key_version: null, unkeyed_contacts: null }, "no_key"],
    [{ key_configured: true, key_version: 1, unkeyed_contacts: null }, "unkeyed"],
    [{ key_configured: true, key_version: 1, unkeyed_contacts: 1 }, "unkeyed"],
    [{ key_configured: true, key_version: 1, unkeyed_contacts: 7 }, "unkeyed"],
    [{ key_configured: true, key_version: 1, unkeyed_contacts: 0 }, "clear"],
  ] as const)("%j is %s", (status, expected) => {
    expect(suppressionReadiness(status)).toBe(expected);
  });
  it("is clear for exactly one input", () => {
    const states = [null, ...[true, false].flatMap((k) => [null, 0, 1, 2, 500].map((n) => ({ key_configured: k, key_version: 1, unkeyed_contacts: n })))];
    expect(states.filter((s) => suppressionReadiness(s) === "clear")).toHaveLength(1);
  });
});

describe("the requests", () => {
  it("reads the status with the token, on the tenant's own path, with no body", async () => {
    apiRequest.mockResolvedValue(STATUS);
    expect(await fetchSuppressionStatus("tok", TENANT)).toEqual(STATUS);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/suppression/status`, "tok");
  });
  it("posts the backfill with no body (the keys are computed on the server)", async () => {
    apiRequest.mockResolvedValue(DONE);
    expect(await runBackfill("tok", TENANT)).toEqual(DONE);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${TENANT}/suppression/backfill`, "tok", { method: "POST" });
  });
  it("refuses a malformed workspace id before any request", async () => {
    await expect(fetchSuppressionStatus("tok", "x")).rejects.toThrow(ApiContractError);
    await expect(runBackfill("tok", "../x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("a body that breaks the contract is an error, never a result", async () => {
    apiRequest.mockResolvedValue({ ...STATUS, key: "CANARY" });
    await expect(fetchSuppressionStatus("tok", TENANT)).rejects.toThrow(ApiContractError);
  });
});
