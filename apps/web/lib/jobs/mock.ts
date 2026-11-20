import { parseJob, parseJobsToday } from "@/lib/api/jobs-parse";

import { previewSample, type SampleType } from "@/lib/screens/preview";

import { WIRE_JOBS, WIRE_JOBS_EXTRA, wireToday } from "./fixtures";
import { localize, personaOf } from "./sample-fixtures";
import type { Job, TodayJobs } from "./types";

/** JOBS=mock: the made-up jobs of the demo shop (Neelambari Silks), the ones in mocks/jobs: the fixtures (lib/jobs/fixtures.ts, the contract's wire shape) run through the REAL parser. Nothing is sent or stored by them; a switch only changes the screen the person is on. */
export const MOCK_JOBS: readonly Job[] = WIRE_JOBS.map(parseJob);

/** `GET /jobs/today` in the mock: the same jobs, what waits for the owner and the main assistant's name. */
export const mockToday = (type: SampleType | null = previewSample()): TodayJobs => parseJobsToday(localize(wireToday(), personaOf(type)));

/** The Jobs page in the mock: the six of Today and two more named jobs with their own voice and number (the page has no fixed number of jobs). */
export const MOCK_PAGE_JOBS: readonly Job[] = [...WIRE_JOBS, ...WIRE_JOBS_EXTRA].map(parseJob);

/** The Jobs page of a SAMPLE business of the staging preview picker (lib/jobs/sample-fixtures.ts): the same eight jobs with that business's names; no type = the saree shop. */
export const mockPageJobs = (type: SampleType | null = previewSample()): readonly Job[] => (type === null || type === "saree" ? MOCK_PAGE_JOBS : [...WIRE_JOBS, ...WIRE_JOBS_EXTRA].map((w) => parseJob(localize(w, personaOf(type)))));
