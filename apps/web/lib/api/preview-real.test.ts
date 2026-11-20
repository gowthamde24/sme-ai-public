import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: undefined as unknown }));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", () => ({ workUnitAsyncStorage: { getStore: () => h.store } }));
const request = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: request }));

import { MOCK_PAGE_JOBS } from "@/lib/jobs/mock";
import { WIRE_JOBS, WIRE_PLANS, wireJobDetail, wireToday } from "@/lib/jobs/fixtures";
import { wireFestivals, wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import { PREVIEW_COOKIE } from "@/lib/screens/preview";

import { ApiRequestError } from "./client";
import { readFestivals, readNewJobSheet } from "./job-templates";
import { getJob, listSuggestions, planJob, readJobs, readJobsToday, setJobEnabled, startPlan, startSuggestion } from "./jobs";
import { readWhatYouSell } from "./what-you-sell";

const TENANT = "11111111-1111-4111-8111-111111111111";
const cookie = (value: string | undefined) => ({ type: "request", cookies: { get: (n: string) => (n === PREVIEW_COOKIE && value !== undefined ? { name: n, value } : undefined) } });
const err = (status: number) => new ApiRequestError(status, status === 404 ? "not_found" : "boom", "x");

/** The fake API: a route -> an answer (a value) or a status (a number: the refusal), anything else is a 404 (not there yet). */
function api(routes: Record<string, unknown>) {
  request.mockImplementation(async (path: string) => {
    const key = Object.keys(routes).find((r) => path.endsWith(r));
    const answer = key === undefined ? 404 : routes[key];
    if (typeof answer === "number") throw err(answer);
    return answer;
  });
}

beforeEach(() => {
  vi.stubEnv("PREVIEW_JOBS", "1");
  vi.stubEnv("JOBS", "");
  vi.stubEnv("BILLING_V2", "");
  request.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  h.store = undefined;
});

describe("MY BUSINESS (cookie `jobs`): the real routes, the sample only where a route is 404", () => {
  beforeEach(() => {
    h.store = cookie("jobs");
  });

  it("templates: a real answer is the real answer (no Sample mark); a 404 is the sample ideas, marked; a 500 is an error, never a sample", async () => {
    const real = wireNewJobSheet("clinic");
    api({ "/jobs/templates": real });
    const got = await readNewJobSheet("tok", TENANT);
    expect(got?.businessType.pack).toBe("clinic");
    expect(got?.sample).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    api({});
    const sample = await readNewJobSheet("tok", TENANT);
    expect(sample?.sample).toBe(true);
    expect(sample?.businessType.pack).toBe("textiles");
    api({ "/jobs/templates": 500 });
    await expect(readNewJobSheet("tok", TENANT)).rejects.toMatchObject({ status: 500 });
    api({ "/jobs/templates": 403 });
    await expect(readNewJobSheet("tok", TENANT)).rejects.toMatchObject({ status: 403 });
  });

  it("festivals: real rows, sample on a 404 (each row marked), nothing drawn and no sample on an empty answer, an error on a 500", async () => {
    const now = new Date("2026-11-20T00:00:00Z");
    api({ "/jobs/festivals": wireFestivals(now) });
    const real = await readFestivals("tok", TENANT, now);
    expect(real).toHaveLength(1);
    expect(real?.[0].sample).toBeUndefined();
    api({});
    expect((await readFestivals("tok", TENANT, now))?.[0].sample).toBe(true);
    api({ "/jobs/festivals": { region: "india", items: [] } });
    expect(await readFestivals("tok", TENANT, now)).toBeNull();
    api({ "/jobs/festivals": 500 });
    await expect(readFestivals("tok", TENANT, now)).rejects.toMatchObject({ status: 500 });
  });

  it("jobs list and Today: real, or sample on a 404 (every job marked), or nothing on a failure (the page says it is not available)", async () => {
    api({ "/jobs": [...WIRE_JOBS.slice(0, 2)], "/jobs/today": wireToday() });
    const jobs = await readJobs("tok", TENANT);
    expect(jobs).toHaveLength(2);
    expect(jobs?.some((j) => j.sample)).toBe(false);
    expect((await readJobsToday("tok", TENANT))?.jobs.some((j) => j.sample)).toBe(false);
    api({});
    const sample = await readJobs("tok", TENANT);
    expect(sample).toHaveLength(MOCK_PAGE_JOBS.length);
    expect(sample?.every((j) => j.sample === true)).toBe(true);
    expect((await readJobsToday("tok", TENANT))?.jobs.every((j) => j.sample === true)).toBe(true);
    api({ "/jobs": 500, "/jobs/today": 500 });
    expect(await readJobs("tok", TENANT)).toBeNull();
    expect(await readJobsToday("tok", TENANT)).toBeNull();
  });

  it("one job: real detail; a 404 on a made-up job is its sample page (marked); a 404 on an id nobody made up is no page; a 500 is no page", async () => {
    const id = MOCK_PAGE_JOBS[0].id;
    api({ [`/jobs/${id}`]: wireJobDetail(id) });
    expect((await getJob("tok", TENANT, id))?.job.sample).toBeUndefined();
    api({});
    expect((await getJob("tok", TENANT, id))?.job.sample).toBe(true);
    expect(await getJob("tok", TENANT, "22222222-2222-4222-8222-222222222222")).toBeNull();
    api({ [`/jobs/${id}`]: 500 });
    expect(await getJob("tok", TENANT, id)).toBeNull();
  });

  it("suggestions: a 404 is the sample three/four, marked; a failure is nothing", async () => {
    api({});
    expect((await listSuggestions("tok", TENANT, null))?.sample).toBe(true);
    api({ "/jobs/suggestions": 500 });
    expect(await listSuggestions("tok", TENANT, null)).toBeNull();
    api({ "/jobs/suggestions": { items: [{ kind: "speed_to_lead", title: null, why: { code: "generic_speed", params: {} }, preview: "Hello", ready: true }] } });
    expect((await listSuggestions("tok", TENANT, null))?.sample).toBeUndefined();
  });

  it("plans: the real planner when it answers; a 404 is the sample planner (marked); a refusal is thrown; a made-up plan stays made-up (never sent to the API)", async () => {
    api({ "/jobs/plan": WIRE_PLANS.speed_to_lead });
    expect((await planJob("tok", TENANT, { kind: "speed_to_lead" }, "en")).sample).toBeUndefined();
    api({});
    const sample = await planJob("tok", TENANT, { kind: "speed_to_lead" }, "en");
    expect(sample.sample).toBe(true);
    api({ "/jobs/plan": 422 });
    await expect(planJob("tok", TENANT, { kind: "speed_to_lead" }, "en")).rejects.toMatchObject({ status: 422 });
    request.mockClear();
    api({});
    await startPlan("tok", TENANT, sample.planId);
    await setJobEnabled("tok", TENANT, MOCK_PAGE_JOBS[0].id, false);
    expect(request).not.toHaveBeenCalled();
    // a plan id the API gave goes to the API
    api({ "/jobs/plan/real-plan-1/start": { job_id: "33333333-3333-4333-8333-333333333333" } });
    expect(await startPlan("tok", TENANT, "real-plan-1")).toEqual({ jobId: "33333333-3333-4333-8333-333333333333" });
    // one-tap start of a suggested job: 404 = the made-up start
    api({});
    expect(await startSuggestion("tok", TENANT, "followups")).toHaveProperty("jobId");
    api({ "/jobs": 500 });
    await expect(startSuggestion("tok", TENANT, "followups")).rejects.toMatchObject({ status: 500 });
  });

  it("What you sell: the real list; a 404 with no old route standing in is the sample list (marked); a failure says 'could not be read'", async () => {
    const services = { style: "services", items: [{ id: "5e110002-0000-4000-8000-000000000001", name: "Haircut", minutes: 30, price_paise: 20000, price_from: false, booking: "any_day", place: null }], next_cursor: null };
    api({ "/what-you-sell?style=services&limit=50": services });
    const real = await readWhatYouSell("tok", TENANT, "services", [], true);
    expect(real).toMatchObject({ state: "ready", data: { live: true } });
    expect(real.state === "ready" && real.data.sample).toBeFalsy();
    api({});
    const sample = await readWhatYouSell("tok", TENANT, "services", [], true);
    expect(sample).toMatchObject({ state: "ready", data: { live: false, sample: true, style: "services" } });
    api({ "/what-you-sell?style=services&limit=50": 500 });
    expect(await readWhatYouSell("tok", TENANT, "services", [], true)).toEqual({ state: "unread" });
  });
});

describe("A SAMPLE BUSINESS (cookie `jobs:<type>`): full mock, no call to the API at all, never mixed with real data", () => {
  it.each([
    ["jobs:realestate", "Sri Sai Homes", "real_estate", "Kiran"],
    ["jobs:school", "Vidya Bharathi School", "education", "Anitha"],
    ["jobs:cars", "Sai Auto Motors", "auto_dealer", "Rohit"],
    ["jobs:saree", "Neelambari Silks", "textiles", "Priya"],
  ])("%s", async (value, business, pack, visits) => {
    h.store = cookie(value);
    api({ "/jobs": [], "/jobs/templates": wireNewJobSheet("clinic"), "/jobs/festivals": { items: [] } });
    const sheet = await readNewJobSheet("tok", TENANT);
    expect(sheet?.businessType.pack).toBe(pack);
    expect(sheet?.sample).toBeUndefined();
    const jobs = await readJobs("tok", TENANT);
    expect(jobs?.map((j) => j.customName)).toContain(visits);
    expect(jobs?.some((j) => j.sample)).toBe(false);
    expect((await getJob("tok", TENANT, MOCK_PAGE_JOBS[0].id))?.business).toBe(business);
    expect(await readFestivals("tok", TENANT)).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
  });
  it("What you sell follows the business: homes for real estate, admissions for the school", async () => {
    h.store = cookie("jobs:realestate");
    const homes = await readWhatYouSell("tok", TENANT, "properties", [], true);
    expect(homes.state === "ready" && homes.data.entries[0].name).toBe("2BHK in Kondapur");
    h.store = cookie("jobs:school");
    const adm = await readWhatYouSell("tok", TENANT, "courses", [], true);
    expect(adm.state === "ready" && adm.data.entries[0].name).toBe("Class 10 admission");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("WITHOUT PREVIEW_JOBS (production) nothing changes: the cookie means nothing", () => {
  beforeEach(() => {
    vi.stubEnv("PREVIEW_JOBS", "");
  });
  it.each(["jobs", "jobs:cars"])("cookie %s, JOBS off: no screens, no call", async (value) => {
    h.store = cookie(value);
    expect(await readJobs("tok", TENANT)).toBeNull();
    expect(await readNewJobSheet("tok", TENANT)).toBeNull();
    expect(await readFestivals("tok", TENANT)).toBeNull();
    expect(await getJob("tok", TENANT, MOCK_PAGE_JOBS[0].id)).toBeNull();
    expect((await readWhatYouSell("tok", TENANT, "services", [], true)).state).toBe("off");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["jobs", "jobs:cars"])("cookie %s, JOBS=1: the real routes, and a 404 is NOT filled from the sample", async (value) => {
    vi.stubEnv("JOBS", "1");
    h.store = cookie(value);
    api({});
    expect(await readJobs("tok", TENANT)).toBeNull();
    expect(await readNewJobSheet("tok", TENANT)).toBeNull();
    expect(await readFestivals("tok", TENANT)).toBeNull();
    expect(await listSuggestions("tok", TENANT, null)).toBeNull();
    expect(await getJob("tok", TENANT, MOCK_PAGE_JOBS[0].id)).toBeNull();
    await expect(planJob("tok", TENANT, { kind: "speed_to_lead" }, "en")).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalled();
  });
  it("the environment's own mock (JOBS=mock) is the saree shop, unchanged, with no Sample marks", async () => {
    vi.stubEnv("JOBS", "mock");
    h.store = cookie("jobs:cars");
    const jobs = await readJobs("tok", TENANT);
    expect(jobs?.map((j) => j.customName)).toContain("Priya");
    expect(jobs?.some((j) => j.sample)).toBe(false);
    expect((await readNewJobSheet("tok", TENANT))?.businessType.pack).toBe("textiles");
  });
});
