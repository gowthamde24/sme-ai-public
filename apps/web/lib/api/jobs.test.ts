import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { MOCK_JOBS } from "@/lib/jobs/mock";
import { CHIP_TONE, JOB_STATUSES, filterJobs } from "@/lib/jobs/types";

import { parseJob, parseJobs, readJobs, setJobEnabled } from "./jobs";

const T = "22222222-2222-4222-8222-222222222222";
const J = "66666666-6666-4666-8666-666666666601";
const wire = { id: J, kind: "followups", custom_name: null, enabled: true, status: "failed", result: { code: "not_sent_window", params: { n: 2 } }, needs_you: 2, last_run_at: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 } };

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("jobs: what the API sends", () => {
  it("reads a job: closed kind and status, a result code with numbers, a fix; nothing is prose", () => {
    expect(parseJob(wire)).toEqual({ id: J, kind: "followups", customName: null, enabled: true, status: "failed", result: { code: "not_sent_window", params: { n: 2 } }, needsYou: 2, lastRunAt: "2026-11-19T03:42:00Z", fix: { code: "template_needed", count: 2 } });
    expect(parseJob({ ...wire, custom_name: "Priya", fix: null, needs_you: undefined }).customName).toBe("Priya");
    expect(parseJobs({ items: [wire] })).toHaveLength(1);
    expect(parseJobs([wire])).toHaveLength(1);
  });
  it("refuses a kind or status it does not know, and a name that is too long", () => {
    expect(() => parseJob({ ...wire, kind: "magic" })).toThrow();
    expect(() => parseJob({ ...wire, status: "exploding" })).toThrow();
    expect(() => parseJob({ ...wire, custom_name: "x".repeat(41) })).toThrow();
    expect(() => parseJob({ ...wire, result: { code: "has space", params: {} } })).toThrow();
  });
  it("every status wears one of the four solid chips", () => {
    for (const s of JOB_STATUSES) expect(["done", "wait", "fail", "info"]).toContain(CHIP_TONE[s]);
    expect(CHIP_TONE.done).toBe("done");
    expect(CHIP_TONE.failed).toBe("fail");
    expect(CHIP_TONE.waiting).toBe("wait");
  });
});

describe("reading and switching", () => {
  it("off: nothing; mock: the made-up jobs, no request; on: the API's, and null when it has no jobs yet", async () => {
    h.mode.v = "off";
    expect(await readJobs("tok", T)).toBeNull();
    h.mode.v = "mock";
    expect((await readJobs("tok", T))?.length).toBe(MOCK_JOBS.length);
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ items: [wire] });
    expect((await readJobs("tok", T))?.[0].kind).toBe("followups");
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs`, "tok");
    h.req.mockRejectedValueOnce(new Error("404"));
    expect(await readJobs("tok", T)).toBeNull();
  });
  it("the switch asks PATCH with {enabled}; the mock answers from the job's own state", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ ...wire, enabled: false, status: "paused" });
    expect(await setJobEnabled("tok", T, J, false)).toEqual({ id: J, enabled: false, status: "paused" });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/jobs/${J}`, "tok", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    h.mode.v = "mock";
    expect(await setJobEnabled("tok", T, MOCK_JOBS[0].id, false)).toMatchObject({ enabled: false, status: "paused" });
    expect(await setJobEnabled("tok", T, MOCK_JOBS[0].id, true)).toMatchObject({ enabled: true, status: "running" });
    await expect(setJobEnabled("tok", T, "nope", true)).rejects.toThrow();
  });
});

describe("the filters", () => {
  it("Running = on, Needs you = waiting or failed or something waits, Paused = off", () => {
    expect(filterJobs(MOCK_JOBS, "all")).toHaveLength(7);
    expect(filterJobs(MOCK_JOBS, "paused").map((j) => j.kind)).toEqual(["payment_reminders"]);
    expect(filterJobs(MOCK_JOBS, "needs_you").map((j) => j.kind)).toEqual(["followups", "offers"]);
    expect(filterJobs(MOCK_JOBS, "running")).toHaveLength(6);
  });
});
